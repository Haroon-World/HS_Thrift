@echo off
title HS_Thrift — Local Server
color 0A
echo.
echo  =====================================================
echo    HS_Thrift Local Server Starting...
echo  =====================================================
echo.
echo  [INFO] Installing dependencies if needed...
call npm install --silent 2>nul
echo.
echo  [START] Launching HS_Thrift at http://localhost:3000
echo.
echo  Store:   http://localhost:3000
echo  Admin:   http://localhost:3000/admin/dashboard.html
echo  Login:   admin@hsthrift.com  /  Admin@1234
echo.
echo  Press Ctrl+C to stop the server.
echo.
start "" http://localhost:3000
node server.js
pause
