@echo off
setlocal
set NURBS_DATA_DIR=%~dp0..\data-cli
if exist "%NURBS_DATA_DIR%" rmdir /s /q "%NURBS_DATA_DIR%"
set NODE=node --no-warnings
echo --- import ---
%NODE% dist\cli.js import examples\quarter-circle.json
echo --- eval ---
%NODE% dist\cli.js eval 1 0,0.5,1
echo --- refine ---
%NODE% dist\cli.js refine 1 0.25,0.5,0.75
echo --- arclength ---
%NODE% dist\cli.js arclength 1 --tol 1e-9
echo --- csv export (head) ---
%NODE% dist\cli.js export 1 2 csv
echo --- illegal refine (expect error + exit code 1) ---
%NODE% dist\cli.js refine 1 0.5,0.5 --version 2
echo exitcode=%ERRORLEVEL%
endlocal
