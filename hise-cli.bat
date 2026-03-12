@echo off
title HISE REPL
if not exist "%~dp0node_modules" (
    echo Installing dependencies...
    npm install --prefix "%~dp0."
)
if not exist "%~dp0dist" (
    echo Building...
    npm run build --prefix "%~dp0."
)
node "%~dp0dist\index.js" %*
if %errorlevel% neq 0 pause
