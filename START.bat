@echo off
title Connectly
echo Installing packages (the first run takes 1-2 minutes)...
call npm install
echo Creating demo accounts...
call npm run seed
echo Starting server at http://localhost:3000
start http://localhost:3000
call npm start
pause
