@echo off
title Operators PM Board connector
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install it from nodejs.org, then run this again. & pause & exit /b 1)
if not exist node_modules\@modelcontextprotocol (echo Installing dependencies once... & call npm ci)
node mcp\server.js
pause
