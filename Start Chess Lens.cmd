@echo off
cd /d "%~dp0"
if not exist dist\app.js call npm run build
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
