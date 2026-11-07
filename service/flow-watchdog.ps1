# ==============================================================================
# Flow Automation · Watchdog & Auto-Healing Service (Windows)
# Mantém o Hermes Gateway (Telegram/API 8642) e o Painel Web de Voz sempre vivos.
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'

$HermesHome = Join-Path $env:LOCALAPPDATA "hermes"
$HermesCmd  = Join-Path $HermesHome "bin\hermes.cmd"
$PastaFrank = Join-Path $env:LOCALAPPDATA "TimeDoFrank"
$LogFile    = Join-Path $PastaFrank "logs\watchdog.log"
$VbsPainel  = Join-Path $PastaFrank "painel\ligar-painel.vbs"

function Log($msg) {
    $data = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $linha = "[$data] $msg"
    Add-Content -Path $LogFile -Value $linha -Encoding UTF8
    # Rotação simples: se passar de 2MB, mantém apenas os últimos 500 registros
    if ((Get-Item $LogFile).Length -gt 2097152) {
        $linhas = Get-Content $LogFile -Tail 500
        Set-Content -Path $LogFile -Value $linhas -Encoding UTF8
    }
}

function Verificar-Gateway {
    try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:8642/health" -TimeoutSec 2 -ErrorAction Stop
        if ($h.status -eq "ok") { return $true }
    } catch {}

    $gwStatus = (& $HermesCmd gateway status 2>&1) -join " "
    if ($gwStatus -match "Gateway process running|Gateway is running") {
        return $true
    }
    
    # Conferir se há processo Python do Hermes rodando o gateway
    $proc = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "hermes.*gateway.*run" }
    if ($proc) { return $true }

    return $false
}

function Iniciar-Gateway {
    Log "Aviso: Hermes Gateway parado. Reiniciando em segundo plano..."
    $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"`& '$HermesCmd' gateway run`""
    Start-Process -FilePath "powershell.exe" -ArgumentList $arg -WindowStyle Hidden
    Start-Sleep -Seconds 3
    if (Verificar-Gateway) {
        Log "Sucesso: Hermes Gateway reiniciado e operacional."
    } else {
        Log "Erro: Falha ao reiniciar Hermes Gateway."
    }
}

function Verificar-Painel {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/saude" -TimeoutSec 2 -ErrorAction Stop
        if ($resp.servico -eq "painel-do-frank") { return $true }
    } catch {}
    return $false
}

function Iniciar-Painel {
    Log "Aviso: Painel Web de Voz não está respondendo. Reiniciando..."
    if (Test-Path $VbsPainel) {
        Start-Process -FilePath "wscript.exe" -ArgumentList "`"$VbsPainel`"" -WindowStyle Hidden
        Start-Sleep -Seconds 3
        if (Verificar-Painel) {
            Log "Sucesso: Painel Web de Voz restabelecido na porta 8787."
        } else {
            Log "Erro: Falha ao reiniciar Painel Web."
        }
    }
}

# Execução do Ciclo de Inspeção
Log "=== Checagem de Saúde do Time de Agentes ==="

if (-not (Verificar-Gateway)) {
    Iniciar-Gateway
} else {
    Log "OK: Gateway (Telegram/API 8642) ativo."
}

if (-not (Verificar-Painel)) {
    Iniciar-Painel
} else {
    Log "OK: Painel Web de Voz (Porta 8787) ativo."
}

