@echo off
title Operators PM Board planner
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install it from nodejs.org, then run this again. & pause & exit /b 1)
node planner\runner.mjs
pause
