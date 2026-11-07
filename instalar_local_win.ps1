# Instala o Time do Frank neste Windows, sem VPS. Linha do manual (aba Windows), colada no Terminal:
#   $env:TDF_RESPOSTAS='CÓDIGO'; irm https://instalar.7dsecrets.com/local-win | iex
# Instala o Hermes Agent na versão testada (se ainda não houver) e passa o resto ao instalar_local.py,
# no Python que o próprio Hermes traz. Não pede administrador.

# Escopo próprio também quando chamado por irm | iex.
& {
$EncodingAnterior = [Console]::OutputEncoding
# Sem ErrorActionPreference Stop: no Windows PowerShell 5.1, ele transforma aviso de programa externo em erro fatal.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { Write-Verbose 'Terminal sem suporte para mudar a codificação da saída.' }
$HermesCommit = if ($env:HERMES_COMMIT) { $env:HERMES_COMMIT } else { 'a50406d9b7474b060450d2dcaff8743c977d296a' }
$BaseUrl = if ($env:TDF_BASE_URL) { $env:TDF_BASE_URL } else { 'https://instalar.7dsecrets.com' }
$Pasta = if ($env:TDF_PASTA) { $env:TDF_PASTA } else { Join-Path $env:LOCALAPPDATA 'TimeDoFrank' }
$Log = Join-Path $Pasta 'instalador-local.log'
$Codigo = "$env:TDF_RESPOSTAS"
Remove-Item Env:TDF_RESPOSTAS -ErrorAction SilentlyContinue

function Amarelo($t) { Write-Host ''; Write-Host $t -ForegroundColor Yellow }
function Ok($t) { Write-Host "    ok $t" -ForegroundColor Green }
function Falha($t) {
  Write-Host ''
  Write-Host "Parou: $t" -ForegroundColor Red
  Write-Host "Registro completo em $Log. Mostre a tela ao Vitor, no canto do manual."
  throw 'time-do-frank'
}
function Achar-Hermes {
  foreach ($nome in 'hermes.exe', 'hermes.cmd') {
    $c = Join-Path $env:LOCALAPPDATA "hermes\bin\$nome"
    if (Test-Path $c) { return $c }
  }
  return $null
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  New-Item -ItemType Directory -Force -Path $Pasta -ErrorAction Stop | Out-Null
  Write-Host ''
  Write-Host 'Time do Frank no seu Windows  ·  instalador local' -ForegroundColor White
  Write-Host 'O Frank vai morar neste computador: ele só responde com o computador ligado e acordado.'

  $Hermes = Achar-Hermes
  if ($Hermes) {
    Amarelo '[0] Hermes Agent já instalado'
    Ok ((& $Hermes --version 2>$null | Select-Object -First 1) -join '')
  } else {
    Amarelo '[0] Instalando o Hermes Agent na versão testada (10 a 30 minutos, conforme a internet)'
    Write-Host '    A tela fica parada enquanto baixa; é normal. Não feche esta janela: aviso a cada minuto.'
    $Instalador = Join-Path $Pasta 'hermes-install.ps1'
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/NousResearch/hermes-agent/$HermesCommit/scripts/install.ps1" -OutFile $Instalador -ErrorAction Stop
    } catch { Falha 'não consegui baixar o instalador do Hermes. Confira a internet e cole a linha de novo.' }
    # Processo próprio: um "exit" dentro do instalador do Hermes não fecha esta janela.
    $Saida = Join-Path $Pasta 'hermes-install.log'
    $Proc = Start-Process -FilePath 'powershell.exe' -PassThru -NoNewWindow -ErrorAction Stop -RedirectStandardOutput $Saida -RedirectStandardError "$Saida.erro" `
      -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$Instalador`"", '-Commit', $HermesCommit, '-NonInteractive', '-SkipBrowser', '-SkipComputerUse')
    # Ler o Handle logo após iniciar: sem ele, o ExitCode volta vazio no Windows PowerShell.
    $null = $Proc.Handle
    $Inicio = Get-Date
    $Avisado = 0
    while (-not $Proc.WaitForExit(5000)) {
      $Minutos = [int][Math]::Floor(((Get-Date) - $Inicio).TotalMinutes)
      if ($Minutos -gt $Avisado) { $Avisado = $Minutos; Write-Host "    ainda instalando o Hermes ($Minutos min)" }
    }
    $Proc.WaitForExit()
    Get-Content $Saida, "$Saida.erro" -ErrorAction SilentlyContinue | Add-Content -Path $Log -Encoding UTF8
    Remove-Item $Instalador, $Saida, "$Saida.erro" -ErrorAction SilentlyContinue
    $Hermes = Achar-Hermes
    if ($Proc.ExitCode -ne 0 -or -not $Hermes) { Falha 'a instalação do Hermes não terminou. Cole a linha de novo: o que já ficou pronto é aproveitado.' }
    Ok ((& $Hermes --version 2>$null | Select-Object -First 1) -join '')
  }

  # O Python do Hermes vem no primeiro item da lista JSON.
  $Py = $null
  try { $Py = ((& $Hermes --print-runtime-command 2>$null) -join '' | ConvertFrom-Json)[0] } catch { Write-Verbose 'Sem a lista do runtime.' }
  if (-not $Py -or -not (Test-Path $Py)) { Falha 'não achei o Python do Hermes.' }

  $Script = Join-Path $Pasta 'instalar_local.py'
  try { Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/local/instalar_local.py" -OutFile $Script -ErrorAction Stop }
  catch { Falha 'não consegui baixar o instalador local. Confira a internet e cole a linha de novo.' }

  $AreaDeTrabalho = [Environment]::GetFolderPath('Desktop')
  $env:TDF_RESPOSTAS = $Codigo
  try { & $Py -I $Script --hermes $Hermes --area-de-trabalho $AreaDeTrabalho }
  finally { Remove-Item Env:TDF_RESPOSTAS -ErrorAction SilentlyContinue }
  if ($LASTEXITCODE -ne 0) { throw 'time-do-frank' }
} catch {
  if ($_.Exception.Message -ne 'time-do-frank') { Write-Host "Parou: erro inesperado: $($_.Exception.Message)" -ForegroundColor Red }
} finally {
  try { [Console]::OutputEncoding = $EncodingAnterior } catch { Write-Verbose 'Não foi possível restaurar a codificação do terminal.' }
}
}
