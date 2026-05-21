@echo off
cd /d "%~dp0"
python -m pixiv_pbd_manager gui
if errorlevel 1 pause
