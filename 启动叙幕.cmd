@echo off
chcp 65001 >nul
if exist "%~dp0desktop\release-ref-priority\win-unpacked\叙幕短片工作台.exe" (
  start "" "%~dp0desktop\release-ref-priority\win-unpacked\叙幕短片工作台.exe"
  exit /b
)
if exist "%~dp0desktop\release-prompts\win-unpacked\叙幕短片工作台.exe" (
  start "" "%~dp0desktop\release-prompts\win-unpacked\叙幕短片工作台.exe"
  exit /b
)
if exist "%~dp0desktop\release-models\win-unpacked\叙幕短片工作台.exe" (
  start "" "%~dp0desktop\release-models\win-unpacked\叙幕短片工作台.exe"
  exit /b
)
if exist "%~dp0desktop\release-exact\win-unpacked\叙幕短片工作台.exe" (
  start "" "%~dp0desktop\release-exact\win-unpacked\叙幕短片工作台.exe"
  exit /b
)
if exist "%~dp0desktop\release-fixed\win-unpacked\叙幕短片工作台.exe" (
  start "" "%~dp0desktop\release-fixed\win-unpacked\叙幕短片工作台.exe"
) else (
  start "" "%~dp0desktop\release\win-unpacked\叙幕短片工作台.exe"
)
