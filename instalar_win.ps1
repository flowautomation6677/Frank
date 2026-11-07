# Time do Frank: instalador para o computador do aluno (Windows). Versão 0.3.10.
#
# Roda no PowerShell do Windows 10 ou 11 do aluno e faz tudo:
#   1. pergunta onde o Frank vai morar (VPS recomendada ou este computador)
#   2. sem VPS ainda: mostra a compra recomendada na Hostinger e espera
#   3. cria a chave de acesso do aluno e leva para a VPS (pede a senha de root uma vez)
#   4. instala a VPS com o instalador do Time do Frank (as perguntas aparecem aqui)
#   5. cria o atalho "Abrir Frank" (painel de voz)
#
# Uso: dois cliques em "Instalar Time do Frank.cmd", ou no PowerShell (sem ser administrador):
#   irm https://instalar.7dsecrets.com/win | iex
#
# Variáveis opcionais (usadas nos testes): TDF_VPS, TDF_SO_CONECTAR=1,
#   TDF_INSTALADOR e TDF_PACOTE (arquivos locais), TDF_INSTALADOR_ARGS.

# Escopo próprio também quando chamado por irm | iex.
& {
$CaminhoAnterior = $env:PATH
$EncodingAnterior = [Console]::OutputEncoding
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { Write-Verbose "Terminal sem suporte para mudar a codificação da saída." }
$BaseUrl       = if ($env:TDF_BASE_URL) { $env:TDF_BASE_URL } else { 'https://instalar.7dsecrets.com' }
$InstaladorUrl = if ($env:INSTALADOR_URL) { $env:INSTALADOR_URL } else { "$BaseUrl/vps" }
$HostingerLink = if ($env:HOSTINGER_LINK) { $env:HOSTINGER_LINK } else { 'https://hostinger.com.br/funnellabs' }
$HostingerCupom = if ($env:HOSTINGER_CUPOM) { $env:HOSTINGER_CUPOM } else { 'FUNNELLABS' }
$SshDir        = Join-Path $env:USERPROFILE '.ssh'
$Chave         = Join-Path $SshDir 'time_do_frank'
$Apelido       = 'time-do-frank'
$ApelidoRoot   = 'time-do-frank-root'
$HermesRemoto  = '/home/hermes/.local/bin/hermes'
$Utf8SemBom    = New-Object System.Text.UTF8Encoding $false

$script:Passo = 0
function Passo($t) { $script:Passo++; Write-Host ""; Write-Host "[$($script:Passo)] $t" -ForegroundColor Yellow }
function Ok($t)    { Write-Host "    ok $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "    aviso: $t" -ForegroundColor DarkYellow }
function Falha($t) { Write-Host ""; Write-Host "Parou: $t" -ForegroundColor Red; throw 'time-do-frank' }
# LogLevel=QUIET: as sondagens não mostram mensagens técnicas em inglês ao aluno.
function Ssh-Lote { & ssh -F $Config -n -o BatchMode=yes -o ConnectTimeout=15 -o LogLevel=QUIET @args | Out-Host; return $LASTEXITCODE }

try {
  Write-Host ''
  Write-Host 'Time do Frank  ·  instalador 0.3.10' -ForegroundColor White
  Write-Host 'Responda às perguntas e aperte Enter. Se travar em alguma parte, o manual mostra cada tela.'

  # ---------- 1. conferências ----------
  Passo 'Conferindo este computador'
  if ($PSVersionTable.PSVersion -lt [Version]'5.1' -or [Environment]::OSVersion.Platform -ne 'Win32NT') { Falha 'use o Windows 10 ou 11 com PowerShell 5.1 ou 7.' }
  # No PowerShell de 32 bits, o OpenSSH de 64 bits fica em Sysnative.
  foreach ($pasta in @("$env:WINDIR\Sysnative\OpenSSH", "$env:WINDIR\System32\OpenSSH")) {
    if (Test-Path (Join-Path $pasta 'ssh.exe')) { $env:PATH = "$pasta;$env:PATH"; break }
  }
  foreach ($p in 'ssh', 'ssh-keygen', 'scp') {
    if (-not (Get-Command $p -ErrorAction SilentlyContinue)) {
      Falha "o Windows está sem o $p. No menu Iniciar, procure Recursos opcionais e adicione Cliente OpenSSH. Se o Windows pedir administrador, peça a quem administra o computador. Não precisa ligar o serviço sshd. Você também pode concluir pelo terminal da VPS no navegador (passo 6)."
    }
  }
  Ok "Windows $([Environment]::OSVersion.Version), PowerShell $($PSVersionTable.PSVersion)"

  # ---------- 2. onde o Frank mora ----------
  $Vps = $env:TDF_VPS
  if (-not $Vps -and $env:TDF_SO_CONECTAR -ne '1' -and -not $env:TDF_INSTALADOR) {
    Passo 'Onde o Frank vai morar?'
    Write-Host ''
    Write-Host '      1  Numa VPS (recomendado). Fica ligado 24 horas, mesmo com o seu computador desligado.'
    Write-Host '      2  Neste computador (chega numa próxima versão).'
    Write-Host ''
    $Onde = ''
    while ($Onde -ne '1' -and $Onde -ne '2') { $Onde = (Read-Host '    Digite 1 ou 2').Trim() }
    if ($Onde -eq '2') { Aviso 'a instalação neste computador chega numa próxima versão. Nesta, o Frank mora numa VPS; vamos por ela.' }
    Passo 'Sua VPS'
    if ((Read-Host '    Você já tem uma VPS com Ubuntu? (s/n)').Trim() -notmatch '^[sSyY]') {
      Write-Host ''
      Write-Host '    Recomendado: VPS KVM 2 da Hostinger, por 12 meses (2 vCPU, 8 GB de memória).'
      Write-Host ''
      Write-Host "      1. Use o link com desconto:  $HostingerLink"
      Write-Host '      2. Escolha o plano KVM 2 e o período de 12 meses.'
      Write-Host "      3. No carrinho, aplique o cupom $HostingerCupom."
      Write-Host '      4. Crie a conta com um e-mail NOVO, que nunca foi usado na Hostinger.'
      Write-Host '         Com e-mail novo, a compra entra pelo link da imersão e o suporte fica liberado.'
      Write-Host '      5. Local do servidor: Brasil ou, se não tiver, Estados Unidos. Sistema: Ubuntu, a primeira versão da lista (26.04), sem painel,'
      Write-Host '         e crie a senha de root. Guarde essa senha: vou pedir daqui a pouco.'
      Write-Host ''
      Read-Host '    Aperte Enter para abrir a Hostinger no navegador' | Out-Null
      Start-Process $HostingerLink
      Write-Host ''
      Write-Host '    Faça a compra com calma. Esta janela fica esperando.'
      Read-Host '    Quando a VPS estiver pronta (o painel da Hostinger mostra o IP), aperte Enter' | Out-Null
    }
  }

  # ---------- 3. endereço da VPS ----------
  Passo 'Endereço da sua VPS'
  if (-not $Vps) { $Vps = Read-Host '    IP da VPS (no painel da Hostinger: VPS > Gerenciar, campo IP)' }
  $Vps = $Vps.Trim()
  $Host_ = $Vps; $Porta = '22'
  if ($Vps -match '^(.+):(\d+)$') { $Host_ = $Matches[1]; $Porta = $Matches[2] }
  if ($Host_ -notmatch '^[A-Za-z0-9.-]+$') { Falha 'esse endereço não parece um IP. Ele tem o formato 123.45.67.89.' }
  if ($Porta -notmatch '^\d{1,5}$' -or [int]$Porta -lt 1 -or [int]$Porta -gt 65535) { Falha 'porta inválida (use de 1 a 65535).' }
  Ok "$Host_ (porta $Porta)"

  # ---------- 3. chave e atalhos ----------
  Passo 'Criando a sua chave de acesso'
  New-Item -ItemType Directory -Force -Path $SshDir | Out-Null
  if (Test-Path $Chave) {
    Ok "chave já existe: $Chave"
  } else {
    # Start-Process preserva a senha vazia no PS 5.1 e no 7, sem cmd.exe.
    $Gerador = Start-Process -FilePath (Get-Command ssh-keygen).Source -ArgumentList ('-q -t ed25519 -N "" -C time-do-frank -f "' + $Chave + '"') -NoNewWindow -Wait -PassThru
    if ($Gerador.ExitCode -ne 0 -or -not (Test-Path $Chave)) { Falha 'não consegui criar a chave de acesso.' }
    Ok "chave criada: $Chave"
  }
  if (-not (Test-Path "$Chave.pub")) {
    $Publica = & ssh-keygen -y -f $Chave
    if ($LASTEXITCODE -ne 0) { Falha 'não consegui recuperar a chave pública.' }
    [IO.File]::WriteAllText("$Chave.pub", (($Publica -join "`n") + "`n"), $Utf8SemBom)
  }
  $Pub = ((Get-Content "$Chave.pub" -Raw -Encoding UTF8).Trim() -split '\s+')[0..1] -join ' '
  # Arquivo exclusivo: não altera nem herda Host * de ~/.ssh/config.
  $Config = Join-Path $SshDir 'time-do-frank.config'
  $ChaveCfg = $Chave -replace '\\', '/'
  $Bloco = @"
# >>> time-do-frank (gerado pelo time-do-frank.ps1; não edite entre os marcadores)
Host $Apelido $ApelidoRoot
  HostName $Host_
  Port $Porta
  IdentityFile "$ChaveCfg"
  UserKnownHostsFile "$ChaveCfg.known_hosts"
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
  ServerAliveInterval 15
  ServerAliveCountMax 3
  ConnectTimeout 15
Host $Apelido
  User hermes
Host $ApelidoRoot
  User root
# <<< time-do-frank
"@
  [System.IO.File]::WriteAllText($Config, (($Bloco -replace "`r`n", "`n") + "`n"), $Utf8SemBom)
  Ok "atalhos de conexão: $Apelido e $ApelidoRoot"

  # ---------- 4. chave na VPS ----------
  Passo 'Levando a chave para a VPS'
  if ((Ssh-Lote $ApelidoRoot true) -eq 0) {
    Ok 'a VPS já reconhece esta chave'
  } else {
    Write-Host '    Agora digite a senha de root da VPS (a que você criou na Hostinger) e aperte Enter.'
    Write-Host '    Ela não aparece enquanto você digita; é normal. É só desta vez.'
    $Remoto = "umask 077; mkdir -p ~/.ssh; grep -qxF '$Pub' ~/.ssh/authorized_keys 2>/dev/null || echo '$Pub' >>~/.ssh/authorized_keys"
    & ssh -F $Config -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive -o StrictHostKeyChecking=accept-new $ApelidoRoot $Remoto
    if ($LASTEXITCODE -ne 0) { Falha 'a VPS não aceitou a senha. Confira a senha de root no painel da Hostinger (VPS > Gerenciar > Configurações) e rode de novo.' }
    if ((Ssh-Lote $ApelidoRoot true) -ne 0) { Falha 'a chave foi enviada, mas a VPS não a aceitou.' }
    Ok 'pronto: daqui para a frente, sem senha'
  }

  # ---------- 5. instalação na VPS ----------
  if ($env:TDF_SO_CONECTAR -eq '1') {
    Passo 'Instalação na VPS: pulada'
  } else {
    Passo 'Instalando o Time do Frank na VPS (10 a 20 minutos)'
    $Ja = & ssh -F $Config -n -o BatchMode=yes $ApelidoRoot "[ -x $HermesRemoto ] && runuser -l hermes -c 'hermes profile list' 2>/dev/null | grep -c '@0\.' || :"
    if ($LASTEXITCODE -ne 0) { Falha 'não consegui conferir a VPS. Confira a internet e tente de novo.' }
    $Rodar = $true
    if ([int]($Ja | Select-Object -Last 1) -ge 8) {
      Ok 'a VPS já tem os 8 agentes instalados'
      $Rodar = ((Read-Host '    Rodar a instalação de novo para atualizar? (s/N)').Trim() -match '^[sSyY]')
    }
    if ($Rodar) {
      $Extra = "$env:TDF_INSTALADOR_ARGS"
      $Codigo = $env:TDF_RESPOSTAS
      Remove-Item Env:TDF_RESPOSTAS -ErrorAction SilentlyContinue
      if (-not $Codigo) {
        $Protegido = Read-Host '    Se tiver o código de respostas do manual, cole e aperte Enter. Se não tiver, só aperte Enter' -AsSecureString
        $Ponteiro = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Protegido)
        try { $Codigo = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Ponteiro) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Ponteiro); $Protegido.Dispose() }
      }
      if ($Codigo) { $Codigo = $Codigo -replace '\s', '' }
      if ($Codigo -and $Codigo -notmatch '^[A-Za-z0-9+/=]+$') { Aviso 'o código veio diferente do manual; as perguntas aparecem aqui.'; $Codigo = $null }
      if ($Codigo) {
        $RespostasRemotas = & ssh -F $Config -n -o BatchMode=yes $ApelidoRoot 'umask 077; mktemp /root/.time-do-frank-respostas.XXXXXXXX'
        if ($LASTEXITCODE -ne 0 -or $RespostasRemotas -notmatch '^/root/\.time-do-frank-respostas\.[A-Za-z0-9]+$') { Falha 'não consegui preparar a transferência das respostas.' }
        $Codigo | & ssh -F $Config -T -o BatchMode=yes $ApelidoRoot "cat > '$RespostasRemotas'"
        if ($LASTEXITCODE -ne 0) { Falha 'a conexão caiu ao enviar as respostas. Rode de novo.' }
        $Codigo = $null
        $Extra = "$Extra --respostas-arquivo $RespostasRemotas"
      }
      if ($env:TDF_INSTALADOR) {
        $Upload = & ssh -F $Config -n -o BatchMode=yes $ApelidoRoot 'umask 077; mktemp -d /root/.time-do-frank-upload.XXXXXXXX'
        if ($LASTEXITCODE -ne 0 -or $Upload -notmatch '^/root/\.time-do-frank-upload\.[A-Za-z0-9]+$') { Falha 'não consegui preparar o envio do instalador.' }
        & scp -F $Config -q $env:TDF_INSTALADOR "${ApelidoRoot}:$Upload/instalar.sh"
        if ($LASTEXITCODE -ne 0) { Falha 'a conexão caiu ao enviar o instalador.' }
        $Preparar = ''
        if ($env:TDF_PACOTE) {
          & scp -F $Config -q $env:TDF_PACOTE "${ApelidoRoot}:$Upload/pacote.tar.gz"
          if ($LASTEXITCODE -ne 0) { Falha 'a conexão caiu ao enviar o pacote.' }
          $Preparar = "mkdir '$Upload/pacote' && tar -xzf '$Upload/pacote.tar.gz' -C '$Upload/pacote' && "
          $Extra = "$Extra --pacote $Upload/pacote"
        }
        $Remoto = "trap 'rm -rf $Upload' EXIT; ${Preparar}bash '$Upload/instalar.sh' $Extra"
      } else {
        $Remoto = "f=`$(mktemp); curl -fSL --connect-timeout 15 --max-time 180 --retry 3 '$InstaladorUrl' -o `"`$f`" || exit 1; bash `"`$f`" $Extra; r=`$?; rm -f `"`$f`"; exit `$r"
      }
      # -t: as perguntas do instalador aparecem aqui, nesta janela.
      & ssh -F $Config -t $ApelidoRoot $Remoto
      if ($LASTEXITCODE -ne 0) { Falha 'a instalação na VPS não terminou. O registro está na VPS em /var/log/instalador-time-do-frank.log.' }
    }
  }

  # ---------- 6. acesso aos agentes ----------
  Passo 'Liberando o acesso aos agentes'
  $Remoto = "id hermes >/dev/null 2>&1 || exit 3; install -d -o hermes -g hermes -m 700 /home/hermes/.ssh; touch /home/hermes/.ssh/authorized_keys; grep -qxF '$Pub' /home/hermes/.ssh/authorized_keys || echo '$Pub' >>/home/hermes/.ssh/authorized_keys; chown hermes:hermes /home/hermes/.ssh/authorized_keys; chmod 600 /home/hermes/.ssh/authorized_keys"
  if ((Ssh-Lote $ApelidoRoot $Remoto) -ne 0) { Falha 'a VPS ainda não tem o Time do Frank instalado. Rode este código de novo, com a instalação.' }
  $N = & ssh -F $Config -n -o BatchMode=yes $Apelido "$HermesRemoto profile list 2>/dev/null | grep -c '@0\.'"
  if ($LASTEXITCODE -ne 0) { Falha 'a conexão caiu. Rode de novo para conectar.' }
  $N = [int]($N | Select-Object -Last 1)
  if ($N -lt 8) { Falha "conectei, mas encontrei $N agentes em vez de 8." }
  Ok "conectado: $N agentes encontrados"
  $SaudeRemota = & ssh -F $Config -n -o BatchMode=yes -o ConnectTimeout=15 $Apelido 'curl -fsS --max-time 5 http://127.0.0.1:8787/api/saude'
  # A voz é opcional: sem painel, o atalho fica criado e avisa o que fazer quando for aberto.
  if ($LASTEXITCODE -ne 0 -or ($SaudeRemota -join '') -notmatch '"servico":"painel-do-frank"') {
    Aviso 'o painel de voz da VPS não respondeu agora. Se o atalho não abrir, rode na VPS: time-do-frank voz'
  }


  # ---------- 8. atalho Abrir Frank ----------
  Passo 'Criando o atalho Abrir Frank (painel de voz no navegador)'
  $Atalho = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Abrir Frank.cmd'
  $PastaLocal = Join-Path $env:LOCALAPPDATA 'TimeDoFrank'
  New-Item -ItemType Directory -Force -Path $PastaLocal | Out-Null
  $Abrir = @'
$ErrorActionPreference = 'Stop'
$Tunel = $null
try {
  $Config = Join-Path $env:USERPROFILE '.ssh\time-do-frank.config'
  $Ssh = (Get-Command ssh -ErrorAction SilentlyContinue).Source
  if (-not $Ssh) {
    foreach ($pasta in @("$env:WINDIR\Sysnative\OpenSSH", "$env:WINDIR\System32\OpenSSH")) {
      if (Test-Path "$pasta\ssh.exe") { $Ssh = "$pasta\ssh.exe"; break }
    }
  }
  if (-not $Ssh) { throw 'Cliente OpenSSH ausente. Rode o instalador do computador novamente.' }
  Write-Host 'Conectando ao Frank. Deixe esta janela aberta enquanto usa a voz.'
  $Porta = $null
  foreach ($Candidata in 8787..8807) {
    $Escuta = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Candidata)
    try { $Escuta.Start(); $Porta = $Candidata; break }
    catch { Write-Verbose "Porta $Candidata ocupada; tentando a próxima." }
    finally { $Escuta.Stop() }
  }
  if (-not $Porta) { throw 'As portas locais estão ocupadas. Feche outro Abrir Frank e tente novamente.' }
  $Argumentos = '-F "' + $Config + '" -n -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -L 127.0.0.1:' + $Porta + ':127.0.0.1:8787 time-do-frank'
  $Tunel = Start-Process -FilePath $Ssh -ArgumentList $Argumentos -NoNewWindow -PassThru
  $Abriu = $false
  for ($i = 0; $i -lt 30; $i++) {
    if ($Tunel.HasExited) { throw 'A conexão SSH falhou. Confira a internet e tente novamente.' }
    try {
      $Saude = Invoke-RestMethod -Uri "http://127.0.0.1:$Porta/api/saude" -TimeoutSec 2
      if ($Saude.servico -eq 'painel-do-frank' -and -not $Tunel.HasExited) { $Abriu = $true; break }
    } catch { Write-Verbose 'Aguardando a resposta do painel.' }
    Start-Sleep -Seconds 1
  }
  if (-not $Abriu) { throw 'O painel não respondeu. Na VPS, rode: time-do-frank voz' }
  Start-Process "http://127.0.0.1:$Porta/"
  Read-Host 'Painel aberto. Aperte Enter nesta janela para encerrar o túnel' | Out-Null
} catch {
  Write-Host ("Não consegui abrir o Frank: " + $_.Exception.Message) -ForegroundColor Red
  Read-Host 'Aperte Enter para fechar' | Out-Null
  exit 1
} finally {
  if ($Tunel -and -not $Tunel.HasExited) { Stop-Process -Id $Tunel.Id -ErrorAction SilentlyContinue }
}
'@
  # Arquivo local com BOM: o Windows PowerShell 5.1 lê os acentos corretamente.
  [IO.File]::WriteAllText((Join-Path $PastaLocal 'Abrir-Frank.ps1'), $Abrir, (New-Object Text.UTF8Encoding $true))
  $Cmd = @'
@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\TimeDoFrank\Abrir-Frank.ps1"
exit /b %errorlevel%
'@
  [System.IO.File]::WriteAllText($Atalho, ($Cmd -replace "`r?`n", "`r`n"), (New-Object System.Text.ASCIIEncoding))
  Ok 'atalho na Área de Trabalho: Abrir Frank'

  Write-Host ''
  Write-Host 'Pronto.' -ForegroundColor Green
  Write-Host '  Fale com o Frank pelo Telegram, ou abra o painel de voz com dois cliques em "Abrir Frank", na Área de Trabalho.'
  Write-Host '  No navegador, permita o microfone quando ele pedir.'
  Write-Host '  Se a conexão cair, rode de novo; a chave e os agentes já instalados são reaproveitados.'
} catch {
  if ($_.Exception.Message -ne 'time-do-frank') { Write-Host "Parou: erro inesperado: $($_.Exception.Message)" -ForegroundColor Red }
  # Pela janela do .cmd, o código de saída avisa a falha. Colado no PowerShell do aluno,
  # só para aqui: exit fecharia a janela dele e um throw mostraria texto técnico em vermelho.
  if ($env:TDF_JANELA -eq '1') { exit 1 }
} finally {
  $env:PATH = $CaminhoAnterior
  try { [Console]::OutputEncoding = $EncodingAnterior } catch { Write-Verbose 'Não foi possível restaurar a codificação do terminal.' }
}
}
