@echo off
rem One-click build: prefer g++, fall back to MSVC cl.exe.
rem (Keep this file pure ASCII: cmd.exe decodes .bat files with the OEM codepage,
rem  and non-ASCII bytes can be misread as command separators.)
setlocal

where g++ >nul 2>nul
if %errorlevel%==0 (
    echo [build] using g++
    g++ -std=c++17 -Wall -Wextra *.cpp -o MyGame.exe
) else (
    echo [build] g++ not found, falling back to MSVC cl.exe
    call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >nul 2>nul
    cl /nologo /std:c++17 /utf-8 /EHsc /W4 *.cpp /Fe:MyGame.exe
)

if errorlevel 1 (
    echo [build] FAILED
    exit /b 1
)
echo [build] OK -^> MyGame.exe
endlocal
