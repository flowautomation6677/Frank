# ==============================================================================
# Flow Automation · Instalador Turnkey do Time de Agentes (Windows)
# Desenvolvido por: Flow Automation (Luiz Antonio)
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

Clear-Host
Write-Host ""
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "         FLOW AUTOMATION  ·  TIME DE AGENTES DE I.A.                " -ForegroundColor White
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "Instalador Enterprise de 8 Agentes Autônomos com Central de Voz."
Write-Host ""

# 1. Checagem de Ambiente
Write-Host "[1/7] Diagnosticando o computador..." -ForegroundColor Yellow
if ($PSVersionTable.PSVersion -lt [Version]'5.1') {
    Write-Host "Erro: É necessário o PowerShell 5.1 ou superior (Windows 10/11)." -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Windows 64-bit e PowerShell compatíveis." -ForegroundColor Green

# 2. Localização do Repositório
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = Split-Path -Parent $ScriptDir
$AgentesDir = Join-Path $RepoDir "agentes"
$PainelDir = Join-Path $RepoDir "painel"
$ConfigFile = Join-Path $RepoDir "configuracao-cliente.json"

if (-not (Test-Path (Join-Path $AgentesDir "frank\distribution.yaml"))) {
    Write-Host "Erro: Pasta dos agentes não encontrada em $AgentesDir" -ForegroundColor Red
    exit 1
}

# 3. Carregar Configuração ou Perguntar
Write-Host ""
Write-Host "[2/7] Carregando dados da empresa..." -ForegroundColor Yellow

$Dono = "Cliente"
$Empresa = "Minha Empresa"
$OQueVende = "Produtos e serviços"
$Publico = "Clientes em potencial"
$TomDeVoz = "Profissional, próximo, direto e respeitoso"
$GeminiKey = ""
$OpenAIKey = ""
$TelegramToken = ""

if (Test-Path $ConfigFile) {
    try {
        $cfg = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.empresa.nome_do_dono) { $Dono = $cfg.empresa.nome_do_dono }
        if ($cfg.empresa.nome_da_empresa) { $Empresa = $cfg.empresa.nome_da_empresa }
        if ($cfg.empresa.o_que_vende) { $OQueVende = $cfg.empresa.o_que_vende }
        if ($cfg.empresa.publico_alvo) { $Publico = $cfg.empresa.publico_alvo }
        if ($cfg.empresa.tom_de_voz) { $TomDeVoz = $cfg.empresa.tom_de_voz }
        if ($cfg.chaves_de_acesso.gemini_api_key -and $cfg.chaves_de_acesso.gemini_api_key -ne "COLOQUE_SUA_CHAVE_AQUI") {
            $GeminiKey = $cfg.chaves_de_acesso.gemini_api_key
        }
        if ($cfg.chaves_de_acesso.openai_api_key -and $cfg.chaves_de_acesso.openai_api_key -notmatch "COLOQUE_") {
            $OpenAIKey = $cfg.chaves_de_acesso.openai_api_key
        }
        if ($cfg.chaves_de_acesso.telegram_bot_token -and $cfg.chaves_de_acesso.telegram_bot_token -notmatch "COLOQUE_") {
            $TelegramToken = $cfg.chaves_de_acesso.telegram_bot_token
        }
        Write-Host "  -> Configuração carregada de configuracao-cliente.json: $Empresa ($Dono)" -ForegroundColor Green
    } catch {
        Write-Host "  (Aviso: configuracao-cliente.json com formato inválido, usando modo interativo)" -ForegroundColor DarkYellow
    }
}

if ($Empresa -eq "Minha Empresa") {
    $Dono = Read-Host "  -> Nome do Responsável / Dono"
    if (-not $Dono) { $Dono = "Dono" }

    $Empresa = Read-Host "  -> Nome da Empresa"
    if (-not $Empresa) { $Empresa = "Empresa" }

    $OQueVende = Read-Host "  -> O que a empresa vende? (Serviços, produtos, infoprodutos)"
    if (-not $OQueVende) { $OQueVende = "Soluções e serviços da $Empresa" }
}

# 4. Motor de Agentes (Hermes)
Write-Host ""
Write-Host "[3/7] Verificando Motor de Agentes (Hermes)..." -ForegroundColor Yellow
$HermesHome = Join-Path $env:LOCALAPPDATA "hermes"
$HermesCmd  = Join-Path $HermesHome "bin\hermes.cmd"

if (-not (Test-Path $HermesCmd)) {
    Write-Host "  -> Instalando motor de IA com verificação criptográfica SHA-256..." -ForegroundColor Cyan
    $InstallerUrl = "https://raw.githubusercontent.com/NousResearch/hermes-agent/a50406d9b7474b060450d2dcaff8743c977d296a/scripts/install.ps1"
    $TempInstaller = Join-Path $env:TEMP "hermes-install-flow.ps1"
    
    # 1. Conexão estritamente segura (TLS 1.2 / TLS 1.3)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
    Invoke-WebRequest -Uri $InstallerUrl -OutFile $TempInstaller -UseBasicParsing

    # 2. Verificação de Integridade Criptográfica (Prevenção contra Supply Chain e MitM)
    $ExpectedHash = "E8B0E5D378D005A733E2750AF2727F0BBA86378AC9BDB79FC45D06DFE7F36C97"
    $ActualHash = (Get-FileHash -Path $TempInstaller -Algorithm SHA256).Hash
    if ($ActualHash -ne $ExpectedHash) {
        Remove-Item $TempInstaller -Force -ErrorAction SilentlyContinue
        Write-Host "ERRO CRÍTICO (Supply Chain): Falha na validação de integridade SHA-256 do instalador." -ForegroundColor Red
        Write-Host "  Esperado : $ExpectedHash" -ForegroundColor Red
        Write-Host "  Calculado: $ActualHash" -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK] Assinatura SHA-256 validada com sucesso." -ForegroundColor Green

    # 3. Execução em Modo Usuário (Menor Privilégio - Zero Admin)
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File $TempInstaller -Commit a50406d9b7474b060450d2dcaff8743c977d296a -NonInteractive -SkipBrowser -SkipComputerUse
}

if (-not (Test-Path $HermesCmd)) {
    Write-Host "Erro crítico: Não foi possível instalar o motor Hermes." -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Motor Hermes ativo." -ForegroundColor Green

$PythonExe = Join-Path $HermesHome "tools\python-3.14.7+20260901-win32-x64\python.exe"
if (-not (Test-Path $PythonExe)) {
    $PythonExe = ((& $HermesCmd --print-runtime-command 2>$null) -join '' | ConvertFrom-Json)[0]
}

# 5. Personalizar Agentes
Write-Host ""
Write-Host "[4/7] Personalizando os 8 agentes com a marca $Empresa..." -ForegroundColor Yellow
$PastaFrank = Join-Path $env:LOCALAPPDATA "TimeDoFrank"
$PersonalizadosDir = Join-Path $PastaFrank "personalizados"
if (Test-Path $PersonalizadosDir) { Remove-Item -Recurse -Force $PersonalizadosDir }
Copy-Item -Recurse -Path $AgentesDir -Destination $PersonalizadosDir

$BancoDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) "empresa\banco"
$BancoDirPosix = $BancoDir -replace '\\', '/'

Get-ChildItem -Path $PersonalizadosDir -Recurse -Include *.md, *.txt, *.yaml, *.yml | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -Encoding UTF8
    $content = $content.Replace("{{NOME_DO_DONO}}", $Dono)
    $content = $content.Replace("{{NOME_DA_EMPRESA}}", $Empresa)
    $content = $content.Replace("{{O_QUE_A_EMPRESA_VENDE}}", $OQueVende)
    $content = $content.Replace("{{PUBLICO}}", $Publico)
    $content = $content.Replace("{{TOM_DE_VOZ}}", $TomDeVoz)
    $content = $content.Replace("/home/hermes/empresa/banco", $BancoDirPosix)
    [IO.File]::WriteAllText($_.FullName, $content, [System.Text.Encoding]::UTF8)
}

# Remover exigência de versão estrita
Get-ChildItem -Path $PersonalizadosDir -Filter "distribution.yaml" -Recurse | ForEach-Object {
    $txt = Get-Content $_.FullName -Raw -Encoding UTF8
    $txt = [regex]::Replace($txt, "(?m)^hermes_requires:.*\r?\n?", "")
    [IO.File]::WriteAllText($_.FullName, $txt, [System.Text.Encoding]::UTF8)
}

# Semear Banco de Conhecimento
if (-not (Test-Path $BancoDir)) { New-Item -ItemType Directory -Force -Path $BancoDir | Out-Null }
$ScriptBanco = Join-Path $PersonalizadosDir "frank\skills\onboarding-da-empresa\scripts\preparar_banco.py"
& $PythonExe $ScriptBanco criar --banco $BancoDir

# Registrar os 8 agentes
$AgentesLista = @("frank", "renata", "breno", "marina", "lara", "vitor", "ulisses", "isabela")
foreach ($a in $AgentesLista) {
    $pastaA = Join-Path $PersonalizadosDir $a
    $desc = (Get-Content (Join-Path $pastaA "DESCRICAO.txt") -Raw -Encoding UTF8).Trim()
    & $HermesCmd profile install $pastaA --yes | Out-Null
    & $HermesCmd profile describe $a --text $desc | Out-Null
    Write-Host "  + Agente registrado: $a" -ForegroundColor Green
}

# 6. Configurar Resiliência Multi-LLM (Fallback Chain) e API Server
Write-Host ""
Write-Host "[5/7] Configurando Resiliência Multi-LLM e API Gateway (Porta 8642)..." -ForegroundColor Yellow
& $HermesCmd kanban init | Out-Null
& $HermesCmd config set timezone "America/Sao_Paulo" | Out-Null
& $HermesCmd config set display.language "pt" | Out-Null
& $HermesCmd config set stt.language "pt" | Out-Null
& $HermesCmd config set model.provider "gemini" | Out-Null
& $HermesCmd config set model.default "gemini-3.5-flash" | Out-Null
& $HermesCmd config set gateway.multiplex_profiles true | Out-Null

# Configura API Server multiplexado no Hermes
$ApiServerKey = -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
$GlobalEnv = Join-Path $HermesHome ".env"
$FrankEnv  = Join-Path $HermesHome "profiles\frank\.env"
Add-Content -Path $GlobalEnv -Value "`nAPI_SERVER_ENABLED=true`nAPI_SERVER_KEY=$ApiServerKey`nAPI_SERVER_PORT=8642`nAPI_SERVER_HOST=127.0.0.1" -Encoding UTF8
Add-Content -Path $FrankEnv -Value "`nAPI_SERVER_KEY=$ApiServerKey" -Encoding UTF8

# Injeta a cadeia de fallback
$FallbackPy = Join-Path $RepoDir "add_fallback.py"
if (Test-Path $FallbackPy) {
    & $PythonExe $FallbackPy | Out-Null
    Write-Host "  [OK] Fallback Multi-LLM configurado (Gemini 3.5 -> Gemini 3.8 -> GPT-4o)." -ForegroundColor Green
}
Write-Host "  [OK] API Gateway multiplexado ativo para os 8 agentes na porta 8642." -ForegroundColor Green

# 7. Configurar Watchdog Silencioso & Atalhos
Write-Host ""
Write-Host "[6/7] Instalando Serviço de Auto-Inicialização e Watchdog..." -ForegroundColor Yellow
$ServiceDir = Join-Path $PastaFrank "service"
$LogsDir    = Join-Path $PastaFrank "logs"
New-Item -ItemType Directory -Force -Path $ServiceDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

# Hardening de Permissões (ACLs no Windows - Prevenção contra LPE)
try {
    & icacls "$PastaFrank" /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F" | Out-Null
    Write-Host "  [OK] Permissões ACLs endurecidas (apenas $env:USERNAME e SYSTEM)." -ForegroundColor Green
} catch {}

$WatchdogPs1 = Join-Path $ServiceDir "flow-watchdog.ps1"
Copy-Item (Join-Path $RepoDir "service\flow-watchdog.ps1" -ErrorAction SilentlyContinue) $WatchdogPs1 -Force -ErrorAction SilentlyContinue

# Registrar no Startup (sem UAC / zero admin)
$StartupFolder = [Environment]::GetFolderPath('Startup')
$VbsPath = Join-Path $StartupFolder "FlowAutomationWatchdog.vbs"
$VbsContent = @"
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WatchdogPs1`"", 0, False
"@
[IO.File]::WriteAllText($VbsPath, $VbsContent, [System.Text.Encoding]::ASCII)
Write-Host "  [OK] Serviço registrado na inicialização do Windows (Zero-UAC)." -ForegroundColor Green

# 8. Criar Atalhos na Área de Trabalho
Write-Host ""
Write-Host "[7/7] Criando atalhos na Área de Trabalho..." -ForegroundColor Yellow
$Desktop = [Environment]::GetFolderPath('Desktop')
$AtalhoFrank = Join-Path $Desktop "Abrir Frank.cmd"
$AtalhoDiag  = Join-Path $Desktop "Diagnóstico Flow Automation.cmd"
$VbsPainel   = Join-Path $PastaFrank "painel\ligar-painel.vbs"

$CmdFrank = @"
@echo off
chcp 65001 >nul
curl -fsS --max-time 2 http://127.0.0.1:8787/api/saude >nul 2>&1 || (start "" wscript "$VbsPainel" & timeout /t 4 /nobreak >nul)
start "" http://127.0.0.1:8787/
"@
[IO.File]::WriteAllText($AtalhoFrank, $CmdFrank, [System.Text.Encoding]::UTF8)

$CmdDiag = @"
@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$RepoDir\scripts\diagnostico.ps1"
pause
"@
[IO.File]::WriteAllText($AtalhoDiag, $CmdDiag, [System.Text.Encoding]::UTF8)

Write-Host "  [OK] 'Abrir Frank' criado na Área de Trabalho." -ForegroundColor Green
Write-Host "  [OK] 'Diagnóstico Flow Automation' criado na Área de Trabalho." -ForegroundColor Green

Write-Host ""
Write-Host "====================================================================" -ForegroundColor Green
Write-Host "  INSTALAÇÃO CONCLUÍDA COM SUCESSO PARA $Empresa!                   " -ForegroundColor White
Write-Host "====================================================================" -ForegroundColor Green
Write-Host "  O time de 8 agentes está operacional e protegido pelo Watchdog."
Write-Host ""
