@echo off
title HISE REPL
node "%~dp0dist\index.js" %*
if %errorlevel% neq 0 pause
