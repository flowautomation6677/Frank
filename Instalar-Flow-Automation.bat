@echo off
chcp 65001 >nul
title Flow Automation - Instalador do Time de Agentes de IA
cls

echo ==============================================================================
echo           FLOW AUTOMATION - INSTALADOR DE AGENTES DE I.A.
echo ==============================================================================
echo.
echo Iniciando o instalador automatizado da Flow Automation...
echo Por favor, aguarde alguns instantes.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\instalar-cliente.ps1"

if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Ocorreu uma falha durante a instalação.
    echo Pressione qualquer tecla para sair...
    pause >nul
    exit /b %errorlevel%
)

echo.
echo [SUCESSO] Instalação concluída com sucesso!
echo Pressione qualquer tecla para encerrar...
pause >nul
exit /b 0

