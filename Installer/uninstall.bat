@echo off
title PAiA Uninstaller
echo.
echo  ╔═══════════════════════════════════════╗
echo  ║      PAiA — Uninstall                 ║
echo  ╚═══════════════════════════════════════╝
echo.

set INSTALL_DIR=%LOCALAPPDATA%\PAiA\App
set DATA_DIR=%LOCALAPPDATA%\PAiA
set SHORTCUT_START=%APPDATA%\Microsoft\Windows\Start Menu\Programs\PAiA.lnk
set SHORTCUT_DESKTOP=%USERPROFILE%\Desktop\PAiA.lnk

echo This will remove:
echo   - PAiA application files
echo   - All PAiA data (history, logs, settings)
echo   - Start Menu and Desktop shortcuts
echo.
set /p CONFIRM="Are you sure? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo Cancelled.
    pause
    exit /b
)

echo.
echo Stopping PAiA...
taskkill /f /im PAiA.exe >nul 2>&1

echo Removing shortcuts...
if exist "%SHORTCUT_START%" del "%SHORTCUT_START%"
if exist "%SHORTCUT_DESKTOP%" del "%SHORTCUT_DESKTOP%"

echo Removing application...
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"

echo.
set /p DELETE_DATA="Delete all PAiA data (history, logs, settings)? (Y/N): "
if /i "%DELETE_DATA%"=="Y" (
    echo Removing data...
    if exist "%DATA_DIR%" rmdir /s /q "%DATA_DIR%"
    echo All data deleted.
) else (
    echo Data preserved at: %DATA_DIR%
)

echo.
echo  ╔═══════════════════════════════════════╗
echo  ║       PAiA has been removed.          ║
echo  ╚═══════════════════════════════════════╝
echo.
pause
