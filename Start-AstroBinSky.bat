@echo off
setlocal
title AstroBin Sky Mapper
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-AstroBinSky.ps1"
