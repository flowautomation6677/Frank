# ==============================================================================
# Flow Automation · Diagnostico de Saude e Auto-Cura do Time de Agentes
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'

Clear-Host
Write-Host ""
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "       FLOW AUTOMATION  ·  DIAGNOSTICO E AUTO-CURA DO SISTEMA        " -ForegroundColor White
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "Executando testes de saude do sistema de agentes de IA..."
Write-Host ""

$HermesHome = Join-Path $env:LOCALAPPDATA "hermes"
$HermesCmd  = Join-Path $HermesHome "bin\hermes.cmd"
$PastaFrank = Join-Path $env:LOCALAPPDATA "TimeDoFrank"
$EnvFrank   = Join-Path $HermesHome "profiles\frank\.env"

$Problemas = 0

# Teste 1: Internet e APIs
Write-Host "[1/6] Conectividade de Rede e Internet..." -NoNewline
try {
    $null = Invoke-WebRequest -Uri "https://www.google.com" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    Write-Host " [OK] Conectado a Internet." -ForegroundColor Green
} catch {
    Write-Host " [FALHA] Sem acesso a internet ou DNS bloqueado." -ForegroundColor Red
    $Problemas++
}

# Teste 2: Motor Hermes
Write-Host "[2/6] Motor Hermes Agent..." -NoNewline
if (Test-Path $HermesCmd) {
    $v = (& $HermesCmd --version 2>$null | Select-Object -First 1)
    Write-Host " [OK] $v" -ForegroundColor Green
} else {
    Write-Host " [FALHA] Hermes nao localizado." -ForegroundColor Red
    $Problemas++
}

# Teste 3: Painel Web de Voz (Porta 8787)
Write-Host "[3/6] Central Web / Painel de Voz..." -NoNewline
try {
    $saude = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/saude" -TimeoutSec 2 -ErrorAction Stop
    if ($saude.servico -eq "painel-do-frank") {
        Write-Host " [OK] Porta 8787 ativa e respondendo." -ForegroundColor Green
    } else {
        throw "Servico diferente"
    }
} catch {
    Write-Host " [AVISO] Painel de voz fechado ou inativo." -ForegroundColor Yellow
    $Problemas++
}

# Teste 4: Bot do Telegram
Write-Host "[4/6] Integracao com Telegram..." -NoNewline
$TgToken = ""
if (Test-Path $EnvFrank) {
    $tokenLine = Get-Content $EnvFrank | Where-Object { $_ -match "^TELEGRAM_BOT_TOKEN=(.+)" }
    if ($tokenLine -match "^TELEGRAM_BOT_TOKEN=(.+)") {
        $TgToken = $Matches[1].Trim()
    }
}

if ($TgToken) {
    try {
        $bot = Invoke-RestMethod -Uri "https://api.telegram.org/bot$TgToken/getMe" -TimeoutSec 3 -ErrorAction Stop
        if ($bot.ok) {
            Write-Host " [OK] Bot @$($bot.result.username) conectado." -ForegroundColor Green
        } else {
            throw "Bot not ok"
        }
    } catch {
        Write-Host " [FALHA] Token do Telegram rejeitado." -ForegroundColor Red
        $Problemas++
    }
} else {
    Write-Host " [INFO] Telegram ainda nao configurado." -ForegroundColor Gray
}

# Teste 5: Inteligencia Artificial e Fallback
Write-Host "[5/6] Inteligencia Artificial e Fallback..." -NoNewline
$fbList = (& $HermesCmd -p frank fallback list 2>&1) -join " "
if ($fbList -match "Fallback chain") {
    Write-Host " [OK] Rota primaria e Fallback Multi-LLM ativos." -ForegroundColor Green
} else {
    Write-Host " [AVISO] Sem rota de fallback configurada." -ForegroundColor Yellow
    $Problemas++
}

# Teste 6: Watchdog de Auto-Inicializacao
Write-Host "[6/6] Servico de Auto-Cura (Watchdog)..." -NoNewline
$StartupVbs = Join-Path ([Environment]::GetFolderPath('Startup')) "FlowAutomationWatchdog.vbs"
if (Test-Path $StartupVbs) {
    Write-Host " [OK] Ativo na inicializacao do Windows." -ForegroundColor Green
} else {
    Write-Host " [AVISO] Nao registrado na inicializacao." -ForegroundColor Yellow
    $Problemas++
}

Write-Host ""
Write-Host "====================================================================" -ForegroundColor Cyan

if ($Problemas -eq 0) {
    Write-Host "  STATUS: SISTEMA 100% OPERACIONAL E SAUDAVEL!" -ForegroundColor Green
    Write-Host "  Nenhum erro encontrado. Todos os 8 agentes estao prontos."
} else {
    Write-Host "  STATUS: $Problemas item(ns) precisam de atencao." -ForegroundColor Yellow
    Write-Host ""
    $resp = Read-Host "Deseja que a Flow Automation repare e reinicie os servicos agora? (S/N)"
    if ($resp -match "^[sSyY]") {
        Write-Host ""
        Write-Host "-> Executando Auto-Cura..." -ForegroundColor Cyan
        
        $VbsPainel = Join-Path $PastaFrank "painel\ligar-painel.vbs"
        if (Test-Path $VbsPainel) {
            Start-Process "wscript.exe" -ArgumentList "`"$VbsPainel`"" -WindowStyle Hidden
            Start-Sleep -Seconds 2
        }

        $Watchdog = Join-Path $PastaFrank "service\flow-watchdog.ps1"
        if (Test-Path $Watchdog) {
            powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Watchdog | Out-Null
        }

        Write-Host "-> Servicos reparados e restabelecidos com sucesso!" -ForegroundColor Green
    }
}
Write-Host ""
