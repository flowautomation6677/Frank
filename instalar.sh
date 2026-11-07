#!/usr/bin/env bash
# Instalador do Time do Frank 0.3.6
#
# Instala numa VPS Ubuntu 24.04 ou 26.04, sem IA guiando: proteção básica do servidor,
# Hermes Agent na versão testada, o Frank e os 7 assistentes com os dados da
# sua empresa, o Telegram do Frank, o cérebro dos agentes, o painel de voz e
# as rotinas da manhã.
#
# Uso na VPS, como root (no Web Console da Hostinger você já é root):
#   curl -fsSL https://instalar.7dsecrets.com/vps | bash
#
# Depois de instalado, para refazer uma parte sem reinstalar tudo:
#   time-do-frank cerebro | modelo | telegram | voz | empresa | grupo
#
# Opções:
#   --pacote DIR      usa uma pasta local com o pacote, em vez de baixar
#   --respostas COD   usa o código do manual; só pergunta o que faltar (sem COD, pede o código)
#   --respostas-arquivo ARQ  lê e apaga o arquivo de respostas que o instalador do computador enviou
#   --sem-perguntas   não pergunta nada; usa as variáveis e as respostas guardadas
#   --sem-firewall    não mexe no firewall (útil em teste)
#   --so PARTE        refaz só uma parte: cerebro, modelo, telegram, voz, empresa ou grupo
#
# Variáveis aceitas (opcionais; servem para teste e reinstalação):
#   NOME_DO_DONO NOME_DA_EMPRESA O_QUE_A_EMPRESA_VENDE PUBLICO TOM_DE_VOZ PALAVRAS_PROIBIDAS
#   TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USERS GEMINI_API_KEY
#   CEREBRO (chatgpt grok claude-assinatura claude gemini ollama openrouter openai deepseek xai compativel depois)
#   CEREBRO_CHAVE CEREBRO_URL MODELO ESFORCO (low medium high xhigh)
#   FUSO (padrão America/Sao_Paulo; horário das rotinas e dos cumprimentos)
#   TDF_BASE_URL PACOTE_URL PACOTE_SHA256 HERMES_COMMIT TDF_TELEGRAM_API TDF_RESPOSTAS

set -Eeuo pipefail

# O bash só executa este bloco depois de recebê-lo inteiro. Download cortado
# em curl | bash termina com erro de sintaxe antes de qualquer alteração.
{

VERSAO_INSTALADOR="0.3.10"
HERMES_COMMIT="${HERMES_COMMIT:-a50406d9b7474b060450d2dcaff8743c977d296a}"
TDF_BASE_URL="${TDF_BASE_URL:-https://instalar.7dsecrets.com}"
PACOTE_URL="${PACOTE_URL:-$TDF_BASE_URL/time-do-frank-$VERSAO_INSTALADOR.tar.gz}"
PACOTE_SHA256="${PACOTE_SHA256:-}"
TG_API="${TDF_TELEGRAM_API:-https://api.telegram.org}"
FUSO="${FUSO:-America/Sao_Paulo}"
USUARIO="hermes"
CASA="/home/${USUARIO}"
HERMES_BIN="${CASA}/.local/bin/hermes"
DESTINO_PACOTE="/opt/time-do-frank"
PERSONALIZADOS="$DESTINO_PACOTE/personalizados"
PLUGIN_CLAUDE="claude-subscription-directsdk-experimental"
BANCO="$CASA/empresa/banco"
RESPOSTAS="/root/.time-do-frank/respostas.env"
PAINEL_DADOS="$CASA/.painel-do-frank"
PAINEL_ENV="$PAINEL_DADOS/.env"
PAINEL_PORTA=8787
NODE_VERSAO="22.23.3"
NODE_DIR="/opt/node"
AGENTES=(frank renata breno marina lara vitor ulisses isabela)
LOG="/var/log/instalador-time-do-frank.log"

PACOTE_LOCAL=""
PERGUNTAR=1
FIREWALL=1
SO=""
CODIGO_RESPOSTAS="${TDF_RESPOSTAS:-}"
unset TDF_RESPOSTAS
PEDIR_CODIGO=0
ARQUIVO_RESPOSTAS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --pacote) PACOTE_LOCAL="${2:?--pacote precisa de uma pasta}"; shift 2 ;;
    # O código vem na própria linha. Sem ele (linha da 0.3.2), o instalador pede o código.
    --respostas) if [ -n "${2:-}" ] && [[ "$2" != -* ]]; then CODIGO_RESPOSTAS="$2"; shift 2; else PEDIR_CODIGO=1; shift; fi ;;
    --respostas-arquivo) ARQUIVO_RESPOSTAS="${2:?informe o arquivo de respostas}"; shift 2 ;;
    --sem-perguntas) PERGUNTAR=0; shift ;;
    --sem-firewall) FIREWALL=0; shift ;;
    --so) SO="${2:?--so precisa de uma parte: cerebro, modelo, telegram, voz, empresa ou grupo}"; shift 2 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "A linha veio diferente da do manual. Volte ao manual, copie a linha de novo e cole inteira." >&2; exit 2 ;;
  esac
done
case "$SO" in ""|cerebro|modelo|telegram|voz|empresa|grupo) ;; *) echo "Parte desconhecida: $SO (use cerebro, modelo, telegram, voz, empresa ou grupo)" >&2; exit 2 ;; esac

# ---------- saída na tela ----------
PASSO=0
passo() { PASSO=$((PASSO + 1)); printf '\n\033[1;33m[%s] %s\033[0m\n' "$PASSO" "$*"; echo "=== [$PASSO] $*" >>"$LOG"; }
ok()    { printf '    \033[32mok\033[0m %s\n' "$*"; }
AVISOS=0
aviso() { AVISOS=$((AVISOS + 1)); printf '    \033[33maviso:\033[0m %s\n' "$*"; echo "AVISO: $*" >>"$LOG"; }
dica()  { printf '    \033[2m%s\033[0m\n' "$*"; }
falha() { printf '\n\033[1;31mParou: %s\033[0m\n' "$*" >&2; printf 'Registro completo em %s. Antes de compartilhar o registro com o suporte, remova senhas, tokens e chaves.\n' "$LOG" >&2; exit 1; }
trap 'falha "erro inesperado na linha $LINENO."' ERR

# Roda um comando como o usuário do Hermes, sem senha e sem herdar o ambiente do root.
# </dev/null: nenhum comando pode parar esperando uma resposta escondida no registro.
como_hermes() { runuser -l "$USUARIO" -c "export PATH=\"$CASA/.local/bin:\$PATH\"; $*" </dev/null >>"$LOG" 2>&1; }

tem_terminal() { [ "$PERGUNTAR" = 1 ] && { : </dev/tty; } 2>/dev/null; }

perguntar() { # perguntar VAR "pergunta" [padrão]
  local var="$1" texto="$2" padrao="${3:-}" valor=""
  [ -n "${!var:-}" ] && return 0
  if respondida "$var"; then printf -v "$var" '%s' "$padrao"; return 0; fi
  if tem_terminal; then read -r -p "    $texto: " valor </dev/tty || true; fi
  [ -n "$valor" ] || valor="$padrao"
  printf -v "$var" '%s' "$valor"
}

perguntar_segredo() { # perguntar_segredo VAR "pergunta"  (não mostra o que é colado)
  local var="$1" texto="$2" valor=""
  [ -n "${!var:-}" ] && return 0
  respondida "$var" && return 0
  tem_terminal || return 0
  read -r -s -p "    $texto: " valor </dev/tty || true; echo
  valor="$(printf '%s' "$valor" | tr -d '[:space:]')"
  [ -n "$valor" ] && dica "recebido (valor oculto)"
  printf -v "$var" '%s' "$valor"
}

ler_oculto() { # ler_oculto VAR "pergunta": sem eco e sem o limite de 4096 caracteres da linha do terminal
  local modo valor=""
  modo="$(stty -g </dev/tty 2>/dev/null || true)"
  trap '[ -n "$modo" ] && stty "$modo" </dev/tty 2>/dev/null; exit 130' INT TERM
  stty -echo -icanon min 1 time 0 </dev/tty 2>/dev/null || true
  printf '%s' "$2" >/dev/tty
  IFS= read -r valor </dev/tty || true
  if [ -n "$modo" ]; then stty "$modo" </dev/tty 2>/dev/null || true; else stty echo icanon </dev/tty 2>/dev/null || true; fi
  trap - INT TERM
  printf '\n' >/dev/tty
  printf -v "$1" '%s' "$(printf '%s' "$valor" | tr -d '[:space:]')"
}

sim_ou_nao() { # sim_ou_nao "pergunta" [s|n]  (sem terminal, vale o padrão)
  local resposta="" padrao="${2:-s}"
  if tem_terminal; then read -r -p "    $1 " resposta </dev/tty || true; fi
  resposta="${resposta:-$padrao}"
  [[ "$resposta" =~ ^[sSyY] ]]
}

exemplo() { tem_terminal && dica "$*"; return 0; }

esperar_enter() { tem_terminal || return 0; printf '\a'; read -r -p "    $1" _ </dev/tty || true; }

grava_env() { # grava_env PERFIL CHAVE VALOR  (substitui a linha se já existir; valor vazio apaga)
  local arq="$CASA/.hermes/profiles/$1/.env" chave="$2" valor="$3"
  [ "$1" = default ] && arq="$CASA/.hermes/.env"
  [ "$1" = painel ] && arq="$PAINEL_ENV"
  [ -d "$(dirname "$arq")" ] || return 0
  install -o "$USUARIO" -g "$USUARIO" -m 600 /dev/null "$arq.novo"
  [ -f "$arq" ] && grep -v "^${chave}=" "$arq" >"$arq.novo" || true
  [ -n "$valor" ] && printf '%s=%s\n' "$chave" "$valor" >>"$arq.novo"
  chown "$USUARIO:$USUARIO" "$arq.novo"; chmod 600 "$arq.novo"
  mv "$arq.novo" "$arq"
}

# ---------- respostas guardadas (para rodar de novo sem perguntar tudo) ----------
EMPRESA=(NOME_DO_DONO NOME_DA_EMPRESA O_QUE_A_EMPRESA_VENDE PUBLICO TOM_DE_VOZ PALAVRAS_PROIBIDAS)
GUARDADAS=("${EMPRESA[@]}" TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USERS CEREBRO CEREBRO_CHAVE CEREBRO_URL MODELO ESFORCO
           GEMINI_API_KEY CHAVE_API_RAIZ CHAVE_API_FRANK)
DO_AMBIENTE=" "
for v in "${GUARDADAS[@]}"; do [ -n "${!v:-}" ] && DO_AMBIENTE+="$v "; printf -v "$v" '%s' "${!v:-}"; done
# Compatibilidade com o 0.1.0: OPENROUTER_API_KEY sozinha escolhe o OpenRouter.
if [ -z "$CEREBRO" ] && [ -n "${OPENROUTER_API_KEY:-}" ]; then CEREBRO=openrouter; CEREBRO_CHAVE="$OPENROUTER_API_KEY"; fi

carregar_respostas() { # só preenche o que não veio do ambiente; com nomes, carrega só esses
  [ -f "$RESPOSTAS" ] || return 0
  local linha chave so=" $* "
  while IFS= read -r linha; do
    [[ "$linha" =~ ^([A-Z_]+)= ]] || continue
    chave="${BASH_REMATCH[1]}"
    [[ " ${GUARDADAS[*]} " == *" $chave "* ]] || continue
    [ $# -eq 0 ] || [[ "$so" == *" $chave "* ]] || continue
    [ -n "${!chave:-}" ] && continue
    eval "$linha"
  done <"$RESPOSTAS"
}

guardar_respostas() {
  install -d -m 700 "$(dirname "$RESPOSTAS")"
  local tmp="$RESPOSTAS.novo" v
  install -m 600 /dev/null "$tmp"
  for v in "${GUARDADAS[@]}"; do [ -n "${!v:-}" ] && printf '%s=%q\n' "$v" "${!v}" >>"$tmp"; done
  mv "$tmp" "$RESPOSTAS"
}

esquecer() { # apaga respostas guardadas; o que veio por variável de ambiente fica
  local v; for v in "$@"; do [[ "$DO_AMBIENTE" == *" $v "* ]] || printf -v "$v" '%s' ""; done
}

liberar_respostas() { # troca explícita: limpa valor e as marcas do manual/ambiente
  local v
  for v in "$@"; do
    printf -v "$v" '%s' ""
    DO_AMBIENTE="${DO_AMBIENTE// $v / }"
    RESPONDIDAS="${RESPONDIDAS// $v / }"
  done
}

# ---------- código de respostas do assistente do manual ----------
# Formato: base64 de linhas CHAVE=valor-em-base64, a primeira "V=1" e a última "FIM=". Só base64 -d do coreutils:
# sem eval e sem python3, que ainda pode não existir na VPS recém-criada. Chave presente com valor
# vazio quer dizer "o aluno decidiu pular" e não vira pergunta no terminal.
RESPONDIDAS=" "
respondida() { [[ "$RESPONDIDAS" == *" $1 "* ]]; }

aplicar_codigo_de_respostas() { # volta 1 se o código chegou cortado; aí nada é aplicado
  local texto linha chave valor i
  local -a chaves=() valores=()
  texto="$(printf '%s' "$1" | tr -d '[:space:]' | base64 -d 2>/dev/null)" || return 1
  [ "${texto%%$'\n'*}" = "V=1" ] || return 1
  # A última linha é "FIM=": sem ela, a colagem cortou o código no meio.
  [[ "$texto" == *$'\n'FIM= ]] || return 1
  while IFS= read -r linha; do
    [[ "$linha" =~ ^([A-Z_]+)=([A-Za-z0-9+/]*=*)$ ]] || return 1
    chave="${BASH_REMATCH[1]}"
    [[ " ${GUARDADAS[*]} " == *" $chave "* ]] || continue
    valor="$(printf '%s' "${BASH_REMATCH[2]}" | base64 -d 2>/dev/null)" || return 1
    { [[ "$valor" != *[[:cntrl:]]* ]] && [ "${#valor}" -le 1000 ]; } || return 1
    chaves+=("$chave"); valores+=("$valor")
  done <<<"$texto"
  for i in "${!chaves[@]}"; do
    # Nome e empresa vazios não contam como "pulou": o terminal pergunta.
    [ -n "${valores[$i]}" ] || [[ "${chaves[$i]}" != NOME_DO_DONO && "${chaves[$i]}" != NOME_DA_EMPRESA ]] || continue
    printf -v "${chaves[$i]}" '%s' "${valores[$i]}"
    DO_AMBIENTE+="${chaves[$i]} "; RESPONDIDAS+="${chaves[$i]} "
  done
}

# ---------- perguntas: empresa ----------
perguntas_empresa() {
  if [ "$PERGUNTAR" = 1 ] && [ -z "$NOME_DO_DONO" ]; then
    echo "    O Frank e o time usam estas respostas para falar como a sua empresa."
    echo "    Responda em uma frase e aperte Enter. Dá para mudar depois com: time-do-frank empresa"
    echo
  fi
  while [ -z "$NOME_DO_DONO" ] && tem_terminal; do perguntar NOME_DO_DONO "Seu primeiro nome (é assim que o Frank vai te chamar)"; done
  while [ -z "$NOME_DA_EMPRESA" ] && tem_terminal; do perguntar NOME_DA_EMPRESA "Nome da sua empresa ou marca"; done
  [ -n "$O_QUE_A_EMPRESA_VENDE" ] || exemplo "Exemplo: curso online de confeitaria para quem está começando"
  perguntar O_QUE_A_EMPRESA_VENDE "O que a empresa vende" "ainda não informado; pergunte ao dono antes de escrever qualquer texto de venda"
  [ -n "$PUBLICO" ] || exemplo "Exemplo: mulheres de 25 a 45 anos que querem uma renda extra"
  perguntar PUBLICO "Para quem vende" "ainda não informado; pergunte ao dono antes de escrever qualquer texto de venda"
  [ -n "$TOM_DE_VOZ" ] || exemplo "Exemplo: próximo e direto, sem gíria. Enter usa esse exemplo."
  perguntar TOM_DE_VOZ "Tom de voz da marca" "próximo, direto e respeitoso, sem gíria e sem exagero"
  [ -n "$PALAVRAS_PROIBIDAS" ] || exemplo "Exemplo: milagre, garantido, fique rico. Enter se não tiver."
  perguntar PALAVRAS_PROIBIDAS "Palavras que a marca nunca usa" "nenhuma definida pelo dono até agora"
  NOME_DO_DONO="${NOME_DO_DONO:-o dono}"; NOME_DA_EMPRESA="${NOME_DA_EMPRESA:-a empresa}"
  ok "empresa: $NOME_DA_EMPRESA (dono: $NOME_DO_DONO)"
}

editar_empresa() { # time-do-frank empresa: mostra cada resposta atual; Enter mantém
  local v novo rotulo
  for v in "${EMPRESA[@]}"; do
    [[ "$DO_AMBIENTE" == *" $v "* ]] && continue
    tem_terminal || continue
    case "$v" in
      NOME_DO_DONO) rotulo="Seu primeiro nome" ;;
      NOME_DA_EMPRESA) rotulo="Nome da empresa ou marca" ;;
      O_QUE_A_EMPRESA_VENDE) rotulo="O que a empresa vende" ;;
      PUBLICO) rotulo="Para quem vende" ;;
      TOM_DE_VOZ) rotulo="Tom de voz da marca" ;;
      PALAVRAS_PROIBIDAS) rotulo="Palavras que a marca nunca usa" ;;
    esac
    dica "Agora: ${!v}"
    novo=""; read -r -p "    $rotulo (Enter mantém): " novo </dev/tty || true
    [ -n "$novo" ] && printf -v "$v" '%s' "$novo"
  done
  ok "empresa: $NOME_DA_EMPRESA (dono: $NOME_DO_DONO)"
}

# ---------- Telegram ----------
tg() { curl -fsS --max-time 40 "$TG_API/bot${TELEGRAM_BOT_TOKEN}/$1" 2>/dev/null; }
tg_enviar() { curl -fsS --max-time 20 "$TG_API/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=$1" --data-urlencode "text=$2" >/dev/null 2>&1 || true; }

BOT_USUARIO=""
conferir_bot() { # preenche BOT_USUARIO; volta 1 se o Telegram recusar o token
  local resp
  resp="$(tg getMe)" || return 1
  BOT_USUARIO="$(printf '%s' "$resp" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["result"]["username"] if d.get("ok") else "")' 2>/dev/null || true)"
  [ -n "$BOT_USUARIO" ]
}

gateway_unidade() { { systemctl list-unit-files 'hermes-gateway*' --no-legend 2>/dev/null || true; } | awk 'NR==1 {print $1}'; }

detectar_dono() { # descobre o ID do dono pelo primeiro "oi" que ele manda ao bot
  local unidade resp fim mensagem maior _uid fid fnome fuser offset=0
  unidade="$(gateway_unidade)"
  # Com o Frank ligado, o gateway pega as mensagens antes de nós.
  if [ -n "$unidade" ] && systemctl is-active --quiet "$unidade"; then systemctl stop "$unidade"; fi
  if tg getWebhookInfo | grep -q '"url":"http'; then
    aviso "esse bot está ligado em outro sistema (webhook). Crie um bot novo só para o Frank no @BotFather."
    return 1
  fi
  echo
  echo "    Agora pegue o celular, abra este link e toque em Iniciar (ou mande um oi):"
  printf '\n        \033[1mhttps://t.me/%s\033[0m\n\n' "$BOT_USUARIO"
  echo "    Estou esperando a sua mensagem (até 5 minutos)..."
  fim=$((SECONDS + 300))
  while [ "$SECONDS" -lt "$fim" ]; do
    resp="$(tg "getUpdates?timeout=20&offset=$offset")" || { sleep 3; continue; }
    # Linha 1: maior update_id; linha 2: última mensagem privada (update, id, nome, usuário).
    { read -r maior; read -r mensagem; } < <(printf '%s' "$resp" | python3 -c '
import json, sys
d = json.load(sys.stdin); maior = ""; ultima = ""
for u in d.get("result", []):
    maior = u["update_id"]
    m = u.get("message") or {}
    f = m.get("from") or {}
    if m.get("chat", {}).get("type") == "private" and f.get("id"):
        limpo = lambda s: " ".join(str(s or "").split())
        ultima = "\t".join([str(u["update_id"]), str(f["id"]), limpo(f.get("first_name")), limpo(f.get("username"))])
print(maior); print(ultima)' 2>/dev/null || printf '\n\n') || true
    [ -n "$maior" ] && offset=$((maior + 1))
    [ -n "$mensagem" ] || continue
    IFS=$'\t' read -r _uid fid fnome fuser <<<"$mensagem"
    if sim_ou_nao "Chegou mensagem de: ${fnome:-sem nome}${fuser:+ (@$fuser)}. É você? (S/n)" s; then
      TELEGRAM_ALLOWED_USERS="$fid"
      tg "getUpdates?offset=$offset&timeout=0" >/dev/null || true
      tg_enviar "$fid" "Achei você, ${fnome:-dono}! Pode voltar para o instalador. Quando a instalação terminar, o Frank fala com você por aqui."
      ok "dono do Frank no Telegram: ${fnome:-sem nome} (ID $fid)"
      return 0
    fi
  done
  aviso "não chegou mensagem em 5 minutos."
  return 1
}

perguntas_telegram() {
  local tentativas=0
  if [ -z "$TELEGRAM_BOT_TOKEN" ] && ! respondida TELEGRAM_BOT_TOKEN && tem_terminal; then
    echo "    O Frank conversa com você por um bot do Telegram. Crie o bot no @BotFather"
    echo "    (o manual mostra em vídeo) e copie o token que ele te dá."
    echo "    Ainda não tem? Aperte Enter sem colar nada e configure depois com: time-do-frank telegram"
    echo
  fi
  while :; do
    perguntar_segredo TELEGRAM_BOT_TOKEN "Cole o token do bot (ele não aparece na tela; é normal)"
    [ -n "$TELEGRAM_BOT_TOKEN" ] || { aviso "Telegram fica para depois: time-do-frank telegram"; return 0; }
    if [[ "$TELEGRAM_BOT_TOKEN" =~ ^[0-9]{5,}:[A-Za-z0-9_-]{30,}$ ]] && conferir_bot; then
      ok "bot encontrado: @$BOT_USUARIO"; break
    fi
    tentativas=$((tentativas + 1))
    aviso "o Telegram não aceitou esse token. Copie de novo do @BotFather (o token tem o formato 123456789:ABC...)."
    liberar_respostas TELEGRAM_BOT_TOKEN
    if [ "$tentativas" -ge 3 ] || ! tem_terminal; then
      TELEGRAM_ALLOWED_USERS=""
      aviso "Telegram fica para depois. Quando terminar, rode: time-do-frank telegram"; return 0
    fi
  done
  [[ "$TELEGRAM_ALLOWED_USERS" =~ ^[0-9]+$ ]] || TELEGRAM_ALLOWED_USERS=""
  if [ -n "$TELEGRAM_ALLOWED_USERS" ]; then
    ok "dono do Frank no Telegram: ID $TELEGRAM_ALLOWED_USERS"
    return 0
  fi
  if ! detectar_dono; then
    dica "Outro jeito: no Telegram, abra o @userinfobot, toque em Iniciar e copie o número do campo Id."
    perguntar TELEGRAM_ALLOWED_USERS "Seu ID do Telegram (só números; Enter para configurar depois)"
    if ! [[ "$TELEGRAM_ALLOWED_USERS" =~ ^[0-9]+$ ]]; then
      # Sem o ID do dono, qualquer pessoa poderia mandar ordens ao Frank. Melhor não ligar.
      TELEGRAM_BOT_TOKEN=""; TELEGRAM_ALLOWED_USERS=""
      aviso "sem o seu ID, o Telegram fica desligado. Ligue depois com: time-do-frank telegram"
    fi
  fi
}

# ---------- cérebro dos agentes ----------
# Cada opção: provedor do Hermes, tipo de acesso, variável da chave, modelo fixo e nome para o aluno.
dados_do_cerebro() {
  PROVEDOR=""; ACESSO=""; VAR_CHAVE=""; MODELO_FIXO=""; NOME_CEREBRO=""; ONDE_CHAVE=""
  case "$1" in
    chatgpt)    PROVEDOR=openai-codex; ACESSO=login; NOME_CEREBRO="ChatGPT (sua assinatura)" ;;
    grok)       PROVEDOR=xai-oauth;    ACESSO=login; NOME_CEREBRO="Grok (sua assinatura)" ;;
    claude-assinatura) PROVEDOR="$PLUGIN_CLAUDE"; ACESSO=login; MODELO_FIXO=sonnet; NOME_CEREBRO="Claude (sua assinatura)" ;;
    claude)     PROVEDOR=anthropic;    ACESSO=chave; VAR_CHAVE=ANTHROPIC_API_KEY; MODELO_FIXO=claude-sonnet-5
                NOME_CEREBRO="Claude (chave de API)"; ONDE_CHAVE="console.anthropic.com > API Keys (a conta precisa de crédito)" ;;
    gemini)     PROVEDOR=gemini;       ACESSO=chave; VAR_CHAVE=GEMINI_API_KEY
                NOME_CEREBRO="Gemini (chave de API)"; ONDE_CHAVE="aistudio.google.com/apikey > Create API key" ;;
    ollama)     PROVEDOR=ollama-cloud; ACESSO=chave; VAR_CHAVE=OLLAMA_API_KEY
                NOME_CEREBRO="Ollama Cloud"; ONDE_CHAVE="ollama.com/settings/keys" ;;
    openrouter) PROVEDOR=openrouter;   ACESSO=chave; VAR_CHAVE=OPENROUTER_API_KEY
                NOME_CEREBRO="OpenRouter"; ONDE_CHAVE="openrouter.ai/keys (a conta precisa de crédito)" ;;
    openai)     PROVEDOR=openai-api;   ACESSO=chave; VAR_CHAVE=OPENAI_API_KEY
                NOME_CEREBRO="OpenAI (chave de API)"; ONDE_CHAVE="platform.openai.com/api-keys (a conta precisa de crédito)" ;;
    deepseek)   PROVEDOR=deepseek;     ACESSO=chave; VAR_CHAVE=DEEPSEEK_API_KEY
                NOME_CEREBRO="DeepSeek"; ONDE_CHAVE="platform.deepseek.com/api_keys" ;;
    xai)        PROVEDOR=xai;          ACESSO=chave; VAR_CHAVE=XAI_API_KEY
                NOME_CEREBRO="xAI (chave de API)"; ONDE_CHAVE="console.x.ai" ;;
    compativel) PROVEDOR=custom;       ACESSO=chave; VAR_CHAVE=TDF_CUSTOM_API_KEY
                NOME_CEREBRO="servidor compatível com OpenAI" ;;
    depois|"")  ACESSO=nenhum; NOME_CEREBRO="ainda não ligado" ;;
    *) return 1 ;;
  esac
}

menu_cerebro() {
  local opcao=""
  cat <<'EOF'
    Onde os seus agentes vão pensar? Escolha um número:

      1  ChatGPT       entra com a sua conta do ChatGPT Plus ou Pro (recomendado se você já assina)
      2  Grok          entra com a sua assinatura SuperGrok
      3  Claude        entra com a sua assinatura Claude Pro ou Max (plugin experimental da Nous)
      4  Gemini        chave de API do Google AI Studio
      5  Ollama Cloud  chave de API do ollama.com (tem plano grátis; no grátis, um agente por vez)
      6  OpenRouter    chave de API, paga por uso, centenas de modelos
      7  Outra         chave da Anthropic, OpenAI, DeepSeek, xAI ou de um servidor compatível com OpenAI
      8  Depois        instala tudo agora e você liga o cérebro mais tarde

EOF
  while :; do
    read -r -p "    Número: " opcao </dev/tty || true
    case "$opcao" in
      1) CEREBRO=chatgpt ;; 2) CEREBRO=grok ;; 3) CEREBRO=claude-assinatura ;; 4) CEREBRO=gemini ;;
      5) CEREBRO=ollama ;; 6) CEREBRO=openrouter ;; 8) CEREBRO=depois ;;
      7) echo
         echo "      a  Anthropic (chave de API)   b  OpenAI   c  DeepSeek   d  xAI   e  outro servidor compatível com OpenAI"
         read -r -p "    Letra: " opcao </dev/tty || true
         case "$opcao" in a|A) CEREBRO=claude ;; b|B) CEREBRO=openai ;; c|C) CEREBRO=deepseek ;; d|D) CEREBRO=xai ;; e|E) CEREBRO=compativel ;; *) continue ;; esac ;;
      *) echo "    Digite um número de 1 a 8."; continue ;;
    esac
    return 0
  done
}

perguntas_cerebro() {
  if [ -z "$CEREBRO" ]; then
    if tem_terminal; then menu_cerebro; else CEREBRO=depois; fi
  fi
  dados_do_cerebro "$CEREBRO" || { aviso "não reconheci o cérebro escolhido; ele fica para depois: time-do-frank cerebro"; CEREBRO=depois; dados_do_cerebro depois; }
  if [ "$ACESSO" = chave ]; then
    # Resposta errada pergunta de novo: parar aqui faria o aluno responder tudo outra vez, até o "oi".
    local tentativa
    if [ "$CEREBRO" = compativel ]; then
      for tentativa in 1 2 3; do
        perguntar CEREBRO_URL "Endereço da API (ex.: https://api.exemplo.com/v1)"
        [[ "$CEREBRO_URL" =~ ^https?://[A-Za-z0-9._:/-]+$ ]] && break
        aviso "esse endereço não parece certo. Ele começa com https:// e termina em /v1."
        CEREBRO_URL=""; tem_terminal || break
      done
      [ -n "$CEREBRO_URL" ] || { aviso "sem o endereço da API, o cérebro fica para depois: time-do-frank cerebro"; CEREBRO=depois; dados_do_cerebro depois; ok "cérebro: $NOME_CEREBRO"; return 0; }
      for tentativa in 1 2 3; do
        perguntar MODELO "Nome do modelo, exatamente como o provedor escreve"
        [ -n "$MODELO" ] && break
        tem_terminal || break
      done
      [ -n "$MODELO" ] || { aviso "sem o nome do modelo, o cérebro fica para depois: time-do-frank cerebro"; CEREBRO=depois; dados_do_cerebro depois; ok "cérebro: $NOME_CEREBRO"; return 0; }
    fi
    if [ -z "$CEREBRO_CHAVE" ] && [ -n "$ONDE_CHAVE" ] && tem_terminal; then dica "Crie a chave em: $ONDE_CHAVE"; fi
    for tentativa in 1 2 3; do
      perguntar_segredo CEREBRO_CHAVE "Cole a chave de API"
      [ -n "$CEREBRO_CHAVE" ] || break
      if [ "$CEREBRO" = openrouter ] && [[ "$CEREBRO_CHAVE" != sk-or-* ]]; then
        aviso "chave do OpenRouter começa com sk-or-. Copie de novo em openrouter.ai/keys."
      elif [ "$CEREBRO" = claude ] && [[ "$CEREBRO_CHAVE" != sk-ant-* ]]; then
        aviso "chave da Anthropic começa com sk-ant-. Copie de novo em console.anthropic.com."
      else
        break
      fi
      CEREBRO_CHAVE=""; tem_terminal || break
    done
    if [ -z "$CEREBRO_CHAVE" ]; then
      aviso "sem chave, o cérebro fica para depois: time-do-frank cerebro"; CEREBRO=depois; dados_do_cerebro depois
    fi
  elif [ "$ACESSO" = login ]; then
    if [ -x "$HERMES_BIN" ]; then dica "O login acontece daqui a 1 ou 2 minutos. Eu aviso com um bipe."
    else dica "O login acontece daqui a uns 10 minutos, quando o Hermes estiver instalado. Eu aviso com um bipe."; fi
  fi
  # A assinatura do Claude só aceita modelos do Claude; modelo de outro cérebro guardado antes não serve.
  [ "$CEREBRO" != claude-assinatura ] || [[ "$MODELO" =~ ^(haiku|sonnet|opus|fable|claude-.*)$ ]] || MODELO=""
  perguntas_modelo
  [ -n "$MODELO_FIXO" ] && [ -z "$MODELO" ] && MODELO="$MODELO_FIXO"
  perguntas_esforco
  if [ "$ACESSO" = nenhum ]; then ok "cérebro: $NOME_CEREBRO"
  else ok "cérebro: $NOME_CEREBRO; modelo: $(nome_do_modelo); esforço: $(nome_do_esforco "$ESFORCO")"; fi
}

# ---------- modelo e esforço ----------
# Modelos do catálogo do Hermes fixado em HERMES_COMMIT; o primeiro é o recomendado e fica com o Enter.
# No Ollama, o recomendado é deixar o instalador testar e escolher (modelo vazio).
opcoes_de_modelo() {
  case "$1" in
    chatgpt)    printf '%s\n' "gpt-6.1-sol|GPT-6.1 Sol: o mais forte" "gpt-6-sol|GPT-6 Sol: a versão anterior" \
                               "gpt-6-luna|GPT-6 Luna: mais rápido, gasta menos do limite da assinatura" ;;
    grok|xai)   printf '%s\n' "grok-4.7|Grok 4.7: o mais novo" "grok-4.6|Grok 4.6: a versão anterior" \
                               "grok-4.3|Grok 4.3: mais rápido e mais barato" ;;
    claude-assinatura)
                printf '%s\n' "sonnet|Sonnet 5.5: o equilíbrio entre qualidade e limite de uso" \
                               "opus|Opus 5.5: mais forte; gasta o limite da assinatura mais rápido" \
                               "haiku|Haiku 5.5: o mais rápido; gasta menos" \
                               "fable|Fable 5.1: o topo; só no plano Max (no Pro, é cobrado à parte)" ;;
    claude)     printf '%s\n' "claude-sonnet-5-5|Claude Sonnet 5.5: o equilíbrio" "claude-opus-5-5|Claude Opus 5.5: mais forte e mais caro" \
                               "claude-haiku-5-5|Claude Haiku 5.5: o mais rápido e mais barato" ;;
    gemini)     printf '%s\n' "gemini-3.8-flash|Gemini 3.8 Flash: rápido e barato" "gemini-3.1-pro-preview|Gemini 3.1 Pro: mais caro" \
                               "gemini-3.1-flash-lite-preview|Gemini 3.1 Flash Lite: o mais barato" ;;
    ollama)     printf '%s\n' "|Automático: o instalador testa e escolhe um que funcione na sua conta" \
                               "glm-5.3|GLM-5.3" "kimi-k3|Kimi K3" "deepseek-v4-pro|DeepSeek V4 Pro" ;;
    openrouter) printf '%s\n' "z-ai/glm-5.3|GLM-5.3: bom e barato" "anthropic/claude-sonnet-5.5|Claude Sonnet 5.5" \
                               "openai/gpt-6.1-sol|GPT-6.1 Sol" "google/gemini-3.8-flash|Gemini 3.8 Flash" ;;
    openai)     printf '%s\n' "gpt-6.1-sol|GPT-6.1 Sol: o mais forte" "gpt-6-sol|GPT-6 Sol: a versão anterior" \
                               "gpt-6-luna|GPT-6 Luna: rápido e barato" ;;
    deepseek)   printf '%s\n' "deepseek-flash|DeepSeek V4.1 Flash: rápido e barato" "deepseek-v4-pro|DeepSeek V4 Pro: mais forte" ;;
  esac
}

perguntas_modelo() {
  local linhas=() i n escolha
  [ "$ACESSO" != nenhum ] && [ "$CEREBRO" != compativel ] || return 0
  [ -z "$MODELO" ] && ! respondida MODELO && tem_terminal || return 0
  while IFS= read -r i; do linhas+=("$i"); done < <(opcoes_de_modelo "$CEREBRO")
  [ ${#linhas[@]} -gt 0 ] || return 0
  echo
  echo "    Qual modelo os agentes vão usar? Na dúvida, aperte Enter: fica o recomendado."
  echo
  for i in "${!linhas[@]}"; do
    printf '      %d  %s' $((i + 1)) "${linhas[$i]#*|}"
    [ "$i" = 0 ] && printf '  (recomendado)'
    echo
  done
  n=$(( ${#linhas[@]} + 1 ))
  printf '      %d  Outro: eu digito o nome do modelo\n\n' "$n"
  while :; do
    read -r -p "    Número (Enter = 1): " escolha </dev/tty || true
    escolha="${escolha:-1}"
    if [[ "$escolha" =~ ^[0-9]+$ ]] && [ "$escolha" -ge 1 ] && [ "$escolha" -lt "$n" ]; then
      MODELO="${linhas[$((escolha - 1))]%%|*}"; return 0
    elif [ "$escolha" = "$n" ]; then
      perguntar MODELO "Nome do modelo, exatamente como o provedor escreve"
      [ -n "$MODELO" ] && return 0
    else
      echo "    Digite um número de 1 a $n."
    fi
  done
}

nome_do_modelo() {
  if [ -n "$MODELO" ]; then echo "$MODELO"; elif [ "$CEREBRO" = ollama ]; then echo automático; else echo "padrão do Hermes"; fi
}

nome_do_esforco() { case "$1" in low) echo baixo ;; high) echo alto ;; xhigh) echo máximo ;; *) echo médio ;; esac; }

perguntas_esforco() { # vale para os 8 agentes; modelo que não usa esforço ignora a escolha
  local escolha
  if [ "$ACESSO" != nenhum ] && [ -z "$ESFORCO" ] && ! respondida ESFORCO && tem_terminal; then
    cat <<'EOF'

    Quanto os agentes pensam antes de responder? Na dúvida, aperte Enter: fica o médio.

      1  Baixo    responde mais rápido e gasta menos
      2  Médio    o equilíbrio  (recomendado)
      3  Alto     pensa mais nas tarefas difíceis; fica mais lento
      4  Máximo   pensa o máximo; bem mais lento e gasta mais

EOF
    while :; do
      read -r -p "    Número (Enter = 2): " escolha </dev/tty || true
      case "${escolha:-2}" in
        1) ESFORCO=low ;; 2) ESFORCO=medium ;; 3) ESFORCO=high ;; 4) ESFORCO=xhigh ;;
        *) echo "    Digite um número de 1 a 4."; continue ;;
      esac
      break
    done
  fi
  case "$ESFORCO" in low|medium|high|xhigh) ;; *) ESFORCO=medium ;; esac
}

# ---------- voz ----------
perguntas_voz() {
  if [ -z "$GEMINI_API_KEY" ] && [ "$CEREBRO" = gemini ] && [ -n "$CEREBRO_CHAVE" ]; then
    GEMINI_API_KEY="$CEREBRO_CHAVE"; ok "a voz usa a mesma chave do Gemini do cérebro"; return 0
  fi
  if [ -z "$GEMINI_API_KEY" ] && ! respondida GEMINI_API_KEY && tem_terminal; then
    echo "    O painel de voz usa o Gemini Live, do Google, para ouvir e falar."
    echo "    A chave sai de graça em: aistudio.google.com/apikey (botão Create API key)."
    echo "    Sem chave agora? Aperte Enter e configure depois com: time-do-frank voz"
  fi
  perguntar_segredo GEMINI_API_KEY "Cole a chave do Gemini"
  if [ -n "$GEMINI_API_KEY" ]; then ok "chave de voz recebida"; else aviso "voz fica para depois: time-do-frank voz"; fi
}

# ---------- personalização e agentes ----------
personalizar_agentes() { # copia os agentes do pacote, troca os {{MARCADORES}} e grava o cérebro escolhido
  dados_do_cerebro "$CEREBRO"
  TDF_PROVEDOR="$PROVEDOR" TDF_MODELO="$MODELO" TDF_URL="$CEREBRO_URL" TDF_FUSO="$FUSO" TDF_ESFORCO="$ESFORCO" \
  TDF_NOME_DO_DONO="$NOME_DO_DONO" TDF_NOME_DA_EMPRESA="$NOME_DA_EMPRESA" \
  TDF_O_QUE_A_EMPRESA_VENDE="$O_QUE_A_EMPRESA_VENDE" TDF_PUBLICO="$PUBLICO" \
  TDF_TOM_DE_VOZ="$TOM_DE_VOZ" TDF_PALAVRAS_PROIBIDAS="$PALAVRAS_PROIBIDAS" \
  python3 - "$DESTINO_PACOTE/agentes" "$PERSONALIZADOS" <<'PY'
import json, os, pathlib, shutil, sys
origem, destino = map(pathlib.Path, sys.argv[1:3])
novo = destino.with_name(destino.name + ".novo")
shutil.rmtree(novo, ignore_errors=True)
shutil.copytree(origem, novo)
marcadores = {k: os.environ.get("TDF_" + k, "") for k in
              ("NOME_DO_DONO", "NOME_DA_EMPRESA", "O_QUE_A_EMPRESA_VENDE", "PUBLICO", "TOM_DE_VOZ", "PALAVRAS_PROIBIDAS")}
for arq in novo.rglob("*"):
    if arq.is_file() and arq.suffix in (".md", ".txt"):
        texto = arq.read_text(encoding="utf-8")
        trocado = texto
        for chave, valor in marcadores.items():
            trocado = trocado.replace("{{%s}}" % chave, valor)
        if trocado != texto:
            arq.write_text(trocado, encoding="utf-8")
fuso = os.environ.get("TDF_FUSO", "")
if fuso:
    # Cada perfil lê o fuso do próprio config.yaml; sem ele, as rotinas seguem o relógio do servidor (UTC na Hostinger).
    for cfg in novo.glob("*/config.yaml"):
        linhas = [l for l in cfg.read_text(encoding="utf-8").splitlines() if not l.startswith("timezone:")]
        cfg.write_text("\n".join(linhas + ['timezone: ' + json.dumps(fuso)]) + "\n", encoding="utf-8")
provedor, modelo, url = (os.environ.get(k, "") for k in ("TDF_PROVEDOR", "TDF_MODELO", "TDF_URL"))
if provedor:
    bloco = ["model:", f"  provider: {provedor}", '  default: ' + json.dumps(modelo)]
    if provedor == "custom":
        bloco += ['  base_url: ' + json.dumps(url), '  api_key: "${TDF_CUSTOM_API_KEY}"']
    for cfg in novo.glob("*/config.yaml"):
        linhas, saida, dentro = cfg.read_text(encoding="utf-8").splitlines(), [], False
        for linha in linhas:
            if linha.startswith("model:"):
                dentro = True; saida += bloco; continue
            if dentro and (linha.startswith((" ", "\t")) or not linha.strip()):
                continue
            dentro = False; saida.append(linha)
        if "model:" not in [l.split("#")[0].strip() for l in linhas]:
            saida += bloco
        cfg.write_text("\n".join(saida) + "\n", encoding="utf-8")
esforco = os.environ.get("TDF_ESFORCO", "")
if esforco:
    # agent.reasoning_effort: dentro do bloco agent: que o pacote tiver; sem ele, um bloco novo no fim.
    for cfg in novo.glob("*/config.yaml"):
        linhas, saida, dentro, gravado = cfg.read_text(encoding="utf-8").splitlines(), [], False, False
        for linha in linhas:
            if linha.startswith("agent:"):
                dentro = True; saida.append(linha); saida.append('  reasoning_effort: ' + json.dumps(esforco)); gravado = True; continue
            if dentro and linha.strip().startswith("reasoning_effort:") and linha.startswith("  ") and not linha.startswith("   "):
                continue
            if dentro and linha.strip() and not linha.startswith((" ", "\t")):
                dentro = False
            saida.append(linha)
        if not gravado:
            saida += ["agent:", '  reasoning_effort: ' + json.dumps(esforco)]
        cfg.write_text("\n".join(saida) + "\n", encoding="utf-8")
shutil.rmtree(destino, ignore_errors=True)
novo.rename(destino)
PY
  chown -R root:root "$PERSONALIZADOS"
  chmod -R go-w "$PERSONALIZADOS"
}

semear_banco() { # o banco é do dono e do Frank: nasce com as respostas do manual e nunca é sobrescrito
  install -d -o "$USUARIO" -g "$USUARIO" -m 750 "$(dirname "$BANCO")"
  if ! como_hermes "python3 '$PERSONALIZADOS/frank/skills/onboarding-da-empresa/scripts/preparar_banco.py' criar --banco '$BANCO'"; then
    aviso "não consegui criar o banco da empresa; o Frank cria na primeira conversa."; return 0
  fi
  chmod 750 "$BANCO"; chmod 640 "$BANCO"/*.md
  ok "banco de conhecimento da empresa: $(find "$BANCO" -maxdepth 1 -name '*.md' | wc -l) arquivos"
}

instalar_agentes() {
  local a descricao
  personalizar_agentes
  semear_banco
  for a in "${AGENTES[@]}"; do
    if [ -d "$CASA/.hermes/profiles/$a" ]; then
      # --force troca soul, skills e config pelos do pacote; memória, sessões e .env ficam.
      como_hermes "hermes profile install '$PERSONALIZADOS/$a' --yes --force" \
        || como_hermes "hermes profile update '$a' --force-config" || aviso "não consegui atualizar $a; ele continua como estava."
    else
      como_hermes "hermes profile install '$PERSONALIZADOS/$a' --yes" || falha "não consegui instalar o agente $a."
    fi
    descricao="$(cat "$PERSONALIZADOS/$a/DESCRICAO.txt")"
    como_hermes "hermes profile describe '$a' --text $(printf '%q' "$descricao")" || aviso "sem descrição no quadro para $a."
    ok "$a"
  done
  tirar_aprovacao_da_032
}

# A 0.3.2 instalava um plugin que pedia o seu ok para toda ferramenta, inclusive cada clique do navegador.
# Volta ao padrão do Hermes: comando perigoso pede aprovação no Telegram; rotina e tarefa sem você não rodam comando perigoso.
tirar_aprovacao_da_032() {
  local perfil dir
  for perfil in default "${AGENTES[@]}"; do
    dir="$CASA/.hermes/profiles/$perfil"
    [ "$perfil" != default ] || dir="$CASA/.hermes"
    [ -d "$dir/plugins/tdf-aprovacao" ] || continue
    como_hermes "hermes -p '$perfil' plugins disable tdf-aprovacao" || true
    rm -rf "$dir/plugins/tdf-aprovacao"
  done
}

aplicar_cerebro() { # chaves nos .env e provedor no perfil-base (os 8 agentes já vêm com ele do pacote)
  local p v
  dados_do_cerebro "$CEREBRO"
  # Tira chaves de cérebros anteriores para o Hermes não escolher outro provedor sozinho.
  for v in ANTHROPIC_API_KEY OLLAMA_API_KEY OPENROUTER_API_KEY OPENAI_API_KEY DEEPSEEK_API_KEY XAI_API_KEY TDF_CUSTOM_API_KEY GOOGLE_API_KEY GEMINI_API_KEY; do
    for p in default "${AGENTES[@]}"; do grava_env "$p" "$v" ""; done
  done
  if [ "$ACESSO" = chave ] && [ -n "$CEREBRO_CHAVE" ]; then
    for p in default "${AGENTES[@]}"; do grava_env "$p" "$VAR_CHAVE" "$CEREBRO_CHAVE"; done
  fi
  como_hermes "hermes config set timezone '$FUSO'" || aviso "não consegui definir o fuso do perfil-base."
  # Pedidos de aprovação do Telegram em português e áudio do dono transcrito como português.
  como_hermes "hermes config set display.language pt" || true
  como_hermes "hermes config set stt.language pt" || true
  [ -n "$PROVEDOR" ] || return 0
  if [ "$PROVEDOR" = "$PLUGIN_CLAUDE" ]; then instalar_claude_code || true; instalar_plugin_claude || true; fi
  # O perfil-base hospeda o gateway e as funções auxiliares (resumo, memória, títulos).
  como_hermes "hermes config set model.provider '$PROVEDOR'" || aviso "não consegui definir o provedor do perfil-base."
  como_hermes "hermes config set model.default '$MODELO'" || aviso "não consegui definir o modelo do perfil-base."
  como_hermes "hermes config set agent.reasoning_effort '${ESFORCO:-medium}'" || aviso "não consegui definir o esforço do perfil-base."
  if [ "$PROVEDOR" = custom ]; then
    como_hermes "hermes config set model.base_url '$CEREBRO_URL'" || true
    como_hermes "hermes config set model.api_key '\${TDF_CUSTOM_API_KEY}'" || true
  else
    # Endereço de um servidor compatível escolhido antes continuaria valendo para o provedor novo.
    como_hermes "hermes config unset model.base_url" || true
    como_hermes "hermes config unset model.api_key" || true
    como_hermes "hermes config unset model.api_mode" || true
  fi
}

# Assinatura do Claude: plugin oficial da Nous que conversa com o Claude Code instalado no usuário dos agentes.
# O login fica em ~/.claude desse usuário; o gateway roda com o mesmo HOME.
instalar_claude_code() {
  [ -x "$CASA/.local/bin/claude" ] && return 0
  como_hermes "curl -fsSL https://claude.ai/install.sh | bash" || true
  [ -x "$CASA/.local/bin/claude" ] || { aviso "não consegui instalar o Claude Code. Depois, rode: time-do-frank cerebro"; return 1; }
  ok "Claude Code instalado"
}

instalar_plugin_claude() { # cada perfil só enxerga os plugins da própria pasta: o perfil-base instala, os agentes recebem cópia
  local base="$CASA/.hermes/plugins/$PLUGIN_CLAUDE" a
  [ -d "$base" ] || como_hermes "hermes plugins install claude-subscription-directsdk" || true
  [ -d "$base" ] || { aviso "não consegui instalar o plugin da assinatura do Claude. Depois, rode: time-do-frank cerebro"; return 1; }
  for a in "${AGENTES[@]}"; do
    install -d -o "$USUARIO" -g "$USUARIO" "$CASA/.hermes/profiles/$a/plugins"
    rm -rf "$CASA/.hermes/profiles/$a/plugins/$PLUGIN_CLAUDE"
    cp -a "$base" "$CASA/.hermes/profiles/$a/plugins/"
  done
}

escolher_modelo_ollama() { # o Ollama Cloud não tem modelo padrão; escolhe o primeiro modelo de agente disponível
  local py
  py="$(runuser -l "$USUARIO" -c "$HERMES_BIN --print-runtime-command" 2>/dev/null </dev/null \
        | python3 -c 'import json,sys; print(json.load(sys.stdin)[0])' 2>/dev/null || true)"
  [ -x "$py" ] || return 0
  runuser -l "$USUARIO" -c "OLLAMA_API_KEY=$(printf '%q' "$CEREBRO_CHAVE") '$py' -I -c '
import os, sys
sys.path.insert(0, os.path.expanduser(\"~/.hermes/hermes-agent\")); sys._hermes_pin_default_home = True
import hermes_bootstrap
from hermes_cli.models import fetch_ollama_cloud_models
from agent.models_dev import list_agentic_models
vivos = fetch_ollama_cloud_models(api_key=os.environ[\"OLLAMA_API_KEY\"], force_refresh=True)
for m in [m for m in list_agentic_models(\"ollama-cloud\") if m in vivos] + vivos:
    print(m)
'" </dev/null 2>>"$LOG" | head -5
}

ja_logado() { # guarda a saída antes de procurar: com pipefail, "comando | grep -q" pode dar falso negativo
  if [ "$1" = "$PLUGIN_CLAUDE" ]; then
    local estado_claude; estado_claude="$(runuser -l "$USUARIO" -c "$CASA/.local/bin/claude auth status" </dev/null 2>/dev/null || true)"
    grep -q '"loggedIn": *true' <<<"$estado_claude"; return
  fi
  local estado; estado="$(runuser -l "$USUARIO" -c "$HERMES_BIN auth status '$1'" </dev/null 2>/dev/null || true)"
  grep -q "^$1: logged in" <<<"$estado"
}

login_cerebro() { # login de assinatura (ChatGPT, Grok ou Claude), direto no terminal do aluno
  dados_do_cerebro "$CEREBRO"
  [ "$ACESSO" = login ] || return 0
  if ja_logado "$PROVEDOR"; then ok "login do $NOME_CEREBRO já feito"; return 0; fi
  tem_terminal || { aviso "login do $NOME_CEREBRO fica para depois: time-do-frank cerebro"; return 1; }
  echo
  esperar_enter "Hora do login do $NOME_CEREBRO. Aperte Enter quando estiver na frente da tela."
  case "$CEREBRO" in
    chatgpt) echo "    Vai aparecer um endereço e um código. Abra o endereço no navegador (pode ser no celular),"
             echo "    entre com a sua conta do ChatGPT e digite o código. Depois volte aqui." ;;
    grok)    echo "    Vai aparecer um endereço e um código. Abra o endereço no navegador (pode ser no celular),"
             echo "    entre com a conta da sua assinatura do Grok e confirme o código. Depois volte aqui." ;;
    claude-assinatura)
             echo "    Vou mostrar um endereço. Abra no navegador (pode ser no celular) e entre com a conta"
             echo "    do seu Claude Pro ou Max. O site mostra um código: copie, volte aqui e cole quando eu pedir."
             echo "    Para copiar daqui, selecione e use o botão direito > Copiar. Para desistir, aperte Enter sem colar nada." ;;
  esac
  [ "$CEREBRO" = claude-assinatura ] || echo "    Para desistir do login, aperte Ctrl+C: a instalação continua."
  echo
  # Com tratador (e não ignorado), o Ctrl+C encerra só o login: o filho volta ao padrão no exec.
  trap ':' INT
  if [ "$PROVEDOR" = "$PLUGIN_CLAUDE" ]; then
    instalar_claude_code || { trap - INT; return 1; }
    login_claude || true
  else
    runuser -l "$USUARIO" -c "$HERMES_BIN auth add '$PROVEDOR' --type oauth --no-browser" </dev/tty >/dev/tty 2>&1 || true
  fi
  trap - INT
  ja_logado "$PROVEDOR" || { aviso "o login não terminou."; return 1; }
  ok "login do $NOME_CEREBRO feito"
}

limpar_codigo_claude() { # tira marcas de colagem, espaços e o que não é do código (letras, números, - _ . ~ e o # do meio)
  local c="$1"
  c="${c//$'\e[200~'/}"; c="${c//$'\e[201~'/}"; c="${c//'[200~'/}"; c="${c//'[201~'/}"
  printf '%s' "$c" | tr -cd 'A-Za-z0-9#._~-'
}

# O prompt do Claude Code não recebe a colagem no terminal web da Hostinger (o código chega estragado e
# o login volta 400). Aqui o código entra pelo prompt do instalador e vai para o Claude Code pela entrada.
parar_login_claude() { # o pid é do subshell; o Claude Code roda como hermes embaixo dele
  pkill -u "$USUARIO" -f 'claude auth login' 2>/dev/null || true
  kill "$1" 2>/dev/null || true; wait "$1" 2>/dev/null || true
  exec 7>&-
}

CODIGO_CLAUDE=""; INTERROMPIDO=0
# No Windows, quem copia o endereço longo aperta Ctrl+C por hábito: aqui ele não cancela, só ganha a dica.
# Desistir é Enter sem colar nada. Lendo de 1 em 1 s, o Ctrl+C é percebido (read com tratador recomeça sozinho).
ler_codigo_claude() {
  local r
  CODIGO_CLAUDE=""
  printf '    Cole aqui o código que o site mostrou e aperte Enter: '
  while :; do
    if IFS= read -r -t 1 CODIGO_CLAUDE </dev/tty; then [ -n "$CODIGO_CLAUDE" ]; return; else r=$?; fi
    [ "$r" -gt 128 ] || return 1
    # Acima de 128 é só o segundo sem Enter: o que já foi colado continua na linha do terminal.
    if [ "$INTERROMPIDO" = 1 ]; then
      INTERROMPIDO=0
      printf '\n    Ctrl+C não copia aqui. Para copiar, selecione e use o botão direito > Copiar.\n'
      printf '    Cole aqui o código que o site mostrou e aperte Enter: '
    fi
  done
}

login_claude() {
  local tentativa pasta saida url codigo pid erro _
  INTERROMPIDO=0; trap 'INTERROMPIDO=1' INT
  for tentativa in 1 2 3; do
    pasta="$(mktemp -d)"; saida="$pasta/saida"; mkfifo "$pasta/entrada"
    # O fd 7 segura a ponta de escrita; o filho não herda a cópia dele.
    exec 7<>"$pasta/entrada"
    { runuser -l "$USUARIO" -c "timeout 900 $CASA/.local/bin/claude auth login --claudeai" || true; } <"$pasta/entrada" >"$saida" 2>&1 7>&- &
    pid=$!
    url=""
    for _ in $(seq 1 30); do
      url="$(grep -o 'https://[^[:space:][:cntrl:]]*oauth/authorize[^[:space:][:cntrl:]]*' "$saida" | head -1 || true)"
      [ -n "$url" ] && break
      sleep 1
    done
    if [ -z "$url" ]; then
      parar_login_claude "$pid"
      cat "$saida" >>"$LOG"; rm -rf "$pasta"
      aviso "o Claude Code não abriu o login."; return 1
    fi
    echo "    Abra este endereço no navegador (selecione a linha inteira; ela é longa):"
    echo
    printf '%s\n\n' "$url"
    codigo=""
    while [ -z "$codigo" ]; do
      if ! ler_codigo_claude; then
        parar_login_claude "$pid"; rm -rf "$pasta"; echo; return 1
      fi
      codigo="$(limpar_codigo_claude "$CODIGO_CLAUDE")"
      if [[ "$codigo" != *?#?* ]]; then
        [ -z "$codigo" ] || aviso "esse não é o código inteiro: ele tem um # no meio. Copie de novo no site e cole."
        codigo=""
      fi
    done
    printf '%s\n' "$codigo" >&7 2>/dev/null || true
    for _ in $(seq 1 60); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    parar_login_claude "$pid"
    sed 's/\x1b\][^\a]*\a//g; s/\x1b\[[0-9;?]*[A-Za-z]//g' "$saida" >>"$LOG"
    if ja_logado "$PLUGIN_CLAUDE"; then rm -rf "$pasta"; return 0; fi
    erro="$(sed 's/\x1b\[[0-9;?]*[A-Za-z]//g' "$saida" | grep -iE 'falh|fail|erro|error|invalid' | tail -1 | sed 's/^.*> *//' | cut -c1-160 || true)"
    rm -rf "$pasta"
    aviso "o Claude não aceitou o código${erro:+ ($erro)}."
    [ "$tentativa" -lt 3 ] || break
    echo "    Vou abrir um login novo. Use o endereço NOVO: o código do endereço anterior não vale mais."
    echo
  done
  return 1
}

RESPOSTA_DO_FRANK=""
testar_cerebro() { # uma pergunta curta ao Frank; passa se a resposta trouxer a palavra pronto
  local saida
  RESPOSTA_DO_FRANK=""
  saida="$(runuser -l "$USUARIO" -c "timeout 180 $HERMES_BIN -p frank chat -Q -q 'Responda apenas com a palavra: pronto'" </dev/null 2>>"$LOG" || true)"
  printf 'teste do cérebro: %s\n' "$(printf '%s' "$saida" | tail -3 | cut -c1-200)" >>"$LOG"
  # Linha que repete a pergunta (erro que ecoa o pedido) não conta como resposta.
  RESPOSTA_DO_FRANK="$(printf '%s\n' "$saida" | grep -iv 'responda\|palavra' | grep -iow 'pronto' | head -1 || true)"
  [ -n "$RESPOSTA_DO_FRANK" ]
}

ligar_cerebro() { # login, modelo e teste; se falhar, oferece outro cérebro (até 3 vezes)
  local tentativa candidatos m
  for tentativa in 1 2 3; do
    dados_do_cerebro "$CEREBRO"
    [ "$ACESSO" = nenhum ] && { aviso "cérebro fica para depois: time-do-frank cerebro"; return 0; }
    if login_cerebro; then
      if [ "$CEREBRO" = ollama ] && [ -n "$MODELO" ] && ! testar_cerebro; then
        aviso "o modelo $MODELO não respondeu na sua conta do Ollama. Vou testar outros."
        MODELO=""
      fi
      if [ "$CEREBRO" = ollama ] && [ -z "$MODELO" ]; then
        candidatos="$(escolher_modelo_ollama || true)"
        for m in $candidatos; do
          MODELO="$m"; instalar_agentes >/dev/null; aplicar_cerebro
          testar_cerebro && break
          MODELO=""
        done
      fi
      if [ -n "$RESPOSTA_DO_FRANK" ] || testar_cerebro; then
        ok "o Frank respondeu: $RESPOSTA_DO_FRANK"
        guardar_respostas
        return 0
      fi
      # Modelo escolhido que a conta não libera: volta ao padrão testado antes de oferecer outro cérebro.
      if [ "$CEREBRO" != ollama ] && [ "$CEREBRO" != compativel ] && [ -n "$MODELO" ] && [ "$MODELO" != "$MODELO_FIXO" ]; then
        aviso "o modelo $MODELO não respondeu. Vou tentar o modelo padrão do $NOME_CEREBRO."
        MODELO="$MODELO_FIXO"
        instalar_agentes >/dev/null; aplicar_cerebro
        if testar_cerebro; then
          ok "o Frank respondeu: $RESPOSTA_DO_FRANK (modelo: $(nome_do_modelo))"
          guardar_respostas
          return 0
        fi
      fi
      aviso "o $NOME_CEREBRO não respondeu. Causas comuns: chave errada, conta sem crédito, assinatura sem acesso ou modelo que a sua conta não libera (troque com: time-do-frank modelo)."
    fi
    [ "$tentativa" -lt 3 ] && tem_terminal && sim_ou_nao "Quer tentar outro cérebro agora? (S/n)" s || break
    # O aluno escolheu trocar: libera inclusive respostas vindas do manual.
    liberar_respostas CEREBRO CEREBRO_CHAVE CEREBRO_URL MODELO ESFORCO
    RESPOSTA_DO_FRANK=""
    perguntas_cerebro
    dica "Passando o cérebro novo para os 8 agentes. Leva 1 ou 2 minutos; a tela fica parada, é normal."
    instalar_agentes >/dev/null
    aplicar_cerebro
  done
  aviso "o Frank ficou sem cérebro funcionando. Para tentar de novo, rode: time-do-frank cerebro"
  guardar_respostas
  return 0
}

# ---------- API do Hermes e painel de voz ----------
ligar_api_do_hermes() { # a API fica só em 127.0.0.1; o painel fala com o Frank por ela
  [ -n "$CHAVE_API_RAIZ" ] || CHAVE_API_RAIZ="$(openssl rand -hex 24)"
  [ -n "$CHAVE_API_FRANK" ] || CHAVE_API_FRANK="$(openssl rand -hex 24)"
  grava_env default API_SERVER_ENABLED true
  grava_env default API_SERVER_KEY "$CHAVE_API_RAIZ"
  grava_env frank API_SERVER_KEY "$CHAVE_API_FRANK"
}

node_ok() {
  [ -x "$NODE_DIR/bin/node" ] && "$NODE_DIR/bin/node" -e '
const [a, b, c] = process.versions.node.split(".").map(Number);
process.exit(a > 22 || (a === 22 && (b > 23 || (b === 23 && c >= 3))) ? 0 : 1)' 2>/dev/null
}

instalar_node() {
  local maquina sha arq
  node_ok && { ok "Node $("$NODE_DIR/bin/node" -v) já instalado"; return 0; }
  case "$(uname -m)" in
    x86_64)        maquina=x64;   sha=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de ;;
    aarch64|arm64) maquina=arm64; sha=a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f ;;
    *) aviso "processador $(uname -m) sem Node pronto; o painel de voz fica de fora."; return 1 ;;
  esac
  arq="node-v${NODE_VERSAO}-linux-${maquina}.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSAO}/${arq}" -o "/tmp/$arq" || { aviso "não consegui baixar o Node."; return 1; }
  echo "$sha  /tmp/$arq" | sha256sum -c - >>"$LOG" 2>&1 || { aviso "o Node baixado não confere; não instalei."; return 1; }
  rm -rf "$NODE_DIR.novo"; mkdir -p "$NODE_DIR.novo"
  tar -xJf "/tmp/$arq" -C "$NODE_DIR.novo" --strip-components=1
  rm -rf "$NODE_DIR"; mv "$NODE_DIR.novo" "$NODE_DIR"; rm -f "/tmp/$arq"
  ln -sf "$NODE_DIR/bin/node" /usr/local/bin/node
  ok "Node $("$NODE_DIR/bin/node" -v)"
}

gravar_env_do_painel() {
  install -d -o "$USUARIO" -g "$USUARIO" -m 700 "$PAINEL_DADOS"
  [ -f "$PAINEL_ENV" ] || install -o "$USUARIO" -g "$USUARIO" -m 600 /dev/null "$PAINEL_ENV"
  grava_env painel FRANK_HOST 127.0.0.1
  grava_env painel FRANK_PORTA_TUNEL_VARIAVEL 1
  grava_env painel PORT ""
  grava_env painel FRANK_PORTA "$PAINEL_PORTA"
  grava_env painel FRANK_PASTA_DE_DADOS "$PAINEL_DADOS/dados"
  grava_env painel HERMES_BIN "$CASA/.local/bin/hermes"
  grava_env painel HERMES_API_URL "http://127.0.0.1:8642/p/frank"
  grava_env painel HERMES_API_KEY "$CHAVE_API_FRANK"
  grava_env painel GEMINI_API_KEY "$GEMINI_API_KEY"
  grava_env painel FRANK_NOME_DO_DONO "$NOME_DO_DONO"
  grava_env painel FRANK_NOME_DA_EMPRESA "$NOME_DA_EMPRESA"
}

instalar_painel() { # a voz é opcional: se algo falhar, o resto da instalação segue
  if [ ! -f "$DESTINO_PACOTE/painel/server.mjs" ]; then aviso "o pacote não trouxe o painel de voz."; return 0; fi
  instalar_node || { aviso "o painel de voz ficou para depois. No fim, rode: time-do-frank voz"; return 0; }
  gravar_env_do_painel
  cat >/etc/systemd/system/painel-do-frank.service <<EOF
[Unit]
Description=Painel de voz do Frank
After=network-online.target

[Service]
User=$USUARIO
WorkingDirectory=$DESTINO_PACOTE/painel
EnvironmentFile=$PAINEL_ENV
ExecStart=$NODE_DIR/bin/node server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable painel-do-frank >>"$LOG" 2>&1 || true
  systemctl restart painel-do-frank >>"$LOG" 2>&1 || true
  if conferir_painel; then ok "painel de voz ligado (só dentro da VPS, porta $PAINEL_PORTA)"
  else aviso "o painel de voz não respondeu. No fim, rode: time-do-frank voz"; fi
}

conferir_painel() { # o painel responde em até 15 s? (saída guardada antes do teste: com pipefail, curl | grep pode falhar à toa)
  local tentativa resposta
  for tentativa in $(seq 1 15); do
    resposta="$(curl -fsS --max-time 2 "http://127.0.0.1:$PAINEL_PORTA/api/saude" 2>/dev/null || true)"
    [[ "$resposta" == *'"servico":"painel-do-frank"'* ]] && return 0
    sleep 1
  done
  return 1
}

reiniciar_painel() {
  [ -f /etc/systemd/system/painel-do-frank.service ] || return 0
  systemctl restart painel-do-frank >>"$LOG" 2>&1 || true
  conferir_painel || aviso "o painel de voz não respondeu. Rode: time-do-frank voz"
}

# Áudio do Telegram: o gateway do Hermes transcreve sozinho quando o faster-whisper existe (extra "voice").
# O modelo base desce aqui, para o primeiro áudio não esperar download. Na VPS KVM 2, 15 s de fala levam 1,5 s.
instalar_transcricao() {
  local py
  como_hermes "hermes pm install --extra voice" || true
  py="$(runuser -l "$USUARIO" -c "$HERMES_BIN --print-runtime-command" 2>/dev/null </dev/null \
        | python3 -c 'import json,sys; print(json.load(sys.stdin)[0])' 2>/dev/null || true)"
  if [ -x "$py" ] && runuser -l "$USUARIO" -c "'$py' -I -c '
import os, sys
sys.path.insert(0, os.path.expanduser(\"~/.hermes/hermes-agent\")); sys._hermes_pin_default_home = True
import hermes_bootstrap
from faster_whisper import WhisperModel
WhisperModel(\"base\", device=\"cpu\", compute_type=\"int8\")
'" </dev/null >>"$LOG" 2>&1; then
    ok "transcrição dos áudios do Telegram ligada"
  else
    aviso "a transcrição dos áudios não instalou; o resto segue."
    PENDENCIAS+=("Áudio no Telegram: cole a mesma linha do manual de novo (o que já está pronto fica)")
  fi
}

# ---------- serviço do Hermes ----------
escolher_pacotes() { # escolher_pacotes "a|b" c ...: de cada grupo, o primeiro nome que o apt desta versão conhece
  local grupo nome
  for grupo in "$@"; do
    for nome in ${grupo//|/ }; do
      if apt-cache show "$nome" >/dev/null 2>&1; then printf '%s ' "$nome"; break; fi
    done
  done
}

instalar_navegador() { # Chromium (navegador do Frank) e cua-driver (Computer Use), pelo gerenciador do próprio Hermes
  como_hermes "hermes pm install agent-browser cua-driver" || true
  if ls "$CASA"/.hermes/tools/chromium-*/*/chrome >/dev/null 2>&1 && ls "$CASA"/.hermes/tools/cua-driver-*/cua-driver >/dev/null 2>&1; then
    ok "navegador (Chromium) e Computer Use"
  else
    aviso "o navegador ou o Computer Use não instalou; o resto segue. Rode o instalador de novo mais tarde."
  fi
  # O Ubuntu 23.10+ só deixa criar o sandbox do Chrome quem tem perfil no AppArmor; sem ele, o Chromium não abre.
  if command -v apparmor_parser >/dev/null 2>&1 && [ -d /etc/apparmor.d ]; then
    cat >/etc/apparmor.d/hermes-chromium <<EOF
# Chromium baixado pelo Hermes: perfil só para liberar o sandbox (user namespaces).
abi <abi/4.0>,
include <tunables/global>

profile hermes-chromium $CASA/.hermes/tools/chromium-*/*/chrome flags=(unconfined) {
  userns,
  include if exists <local/hermes-chromium>
}
EOF
    apparmor_parser -r /etc/apparmor.d/hermes-chromium >>"$LOG" 2>&1 || aviso "não consegui liberar o sandbox do navegador (AppArmor)."
  fi
}

ligar_tela_virtual() { # tela virtual :99 para o Computer Use (a VPS não tem monitor)
  command -v Xvfb >/dev/null 2>&1 || { aviso "sem a tela virtual (Xvfb); o Computer Use fica desligado."; return 0; }
  cat >/etc/systemd/system/tela-virtual-do-frank.service <<EOF
[Unit]
Description=Tela virtual do Frank (Computer Use)
After=network.target

[Service]
User=$USUARIO
ExecStart=/usr/bin/Xvfb :99 -screen 0 1440x900x24 -nolisten tcp
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  if systemctl enable --now tela-virtual-do-frank >>"$LOG" 2>&1; then ok "tela virtual ligada (Computer Use)"; else aviso "a tela virtual não ligou; o Computer Use fica desligado."; fi
}

dar_tela_ao_frank() { # o serviço do Hermes enxerga a tela virtual pela variável DISPLAY
  local unidade dir conf
  unidade="$(gateway_unidade)"; [ -n "$unidade" ] && [ -f /etc/systemd/system/tela-virtual-do-frank.service ] || return 0
  dir="/etc/systemd/system/$unidade.d"; mkdir -p "$dir"
  conf="$(printf '[Unit]\nAfter=tela-virtual-do-frank.service\nWants=tela-virtual-do-frank.service\n\n[Service]\nEnvironment=DISPLAY=:99')"
  if [ "$(cat "$dir/tela-virtual.conf" 2>/dev/null)" != "$conf" ]; then
    printf '%s\n' "$conf" >"$dir/tela-virtual.conf"
    systemctl daemon-reload
    systemctl restart "$unidade" >>"$LOG" 2>&1 || aviso "não consegui religar o Frank com a tela virtual."
  fi
}

ligar_gateway() {
  local unidade
  unidade="$(gateway_unidade)"
  if [ -n "$unidade" ]; then
    systemctl restart "$unidade" && ok "Frank religado com a configuração nova" || falha "não consegui religar o serviço. Veja o registro."
  elif HERMES_HOME="$CASA/.hermes" "$HERMES_BIN" gateway install --system --run-as-user "$USUARIO" --start-now --start-on-login </dev/null >>"$LOG" 2>&1; then
    ok "serviço do Hermes instalado; volta sozinho se a VPS reiniciar"
  else
    falha "não consegui instalar o serviço. Veja o registro."
  fi
}

# ---------- rotinas ----------
cria_rotina() { # cria_rotina PERFIL NOME HORARIO ENTREGA PROMPT
  # Guarda a lista antes de procurar: com pipefail, "comando | grep -q" pode dar falso "não encontrado".
  local lista; lista="$(runuser -l "$USUARIO" -c "$HERMES_BIN -p '$1' cron list" 2>/dev/null </dev/null || true)"
  if grep -q -- "Name: *$2\$" <<<"$lista"; then
    # O ID fica na linha acima do nome: "4977d9f8bbdd [active]".
    local id; id="$(awk -v n="$2" '$1 ~ /^[0-9a-f]+$/ {ultimo=$1} $1 == "Name:" && $2 == n {print ultimo; exit}' <<<"$lista")"
    [ -n "$id" ] && como_hermes "hermes -p '$1' cron edit '$id' --deliver '$4'" || true
    ok "rotina $2 de $1 já existe (entrega: $4)"; return 0
  fi
  como_hermes "hermes -p '$1' cron create '$3' $(printf '%q' "$5") --name '$2' --deliver '$4'" \
    && ok "rotina $2 de $1 ($3)" || aviso "não consegui criar a rotina $2 de $1."
}

criar_rotinas() {
  local entrega="local"
  [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_ALLOWED_USERS" ] && entrega="telegram"
  cria_rotina isabela numeros-da-manha "30 7 * * *" local \
    "Prepare os números de ontem: investido, vendido, conversas novas e o que pausar. Registre como tarefa concluída no quadro, para o Frank."
  cria_rotina frank resumo-da-manha "0 8 * * *" "$entrega" \
    "Monte o resumo da manhã para o dono: o que cada assistente entregou, o que espera aprovação e o que é decisão dele. Use o quadro de tarefas e os números da Isabela."
}

gravar_telegram() {
  grava_env frank TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN"
  grava_env frank TELEGRAM_ALLOWED_USERS "$TELEGRAM_ALLOWED_USERS"
  # Home channel = conversa do dono: é para onde vão o resumo das 8h e os avisos do Hermes.
  grava_env frank TELEGRAM_HOME_CHANNEL "$TELEGRAM_ALLOWED_USERS"
}

instalar_comando() { # time-do-frank <parte>: refaz uma parte sem reinstalar tudo
  escrever_grupo_py
  cat >/usr/local/bin/time-do-frank <<EOF
#!/bin/bash
# Refaz uma parte do Time do Frank. Uso: time-do-frank cerebro | modelo | telegram | voz | empresa | grupo
# time-do-frank avisar AGENTE "texto" escreve no tópico do agente no grupo do time; os agentes rodam sem sudo.
[ "\${1:-}" = avisar ] && exec python3 $GRUPO_PY avisar "\${@:2}"
[ "\$(id -u)" = 0 ] || exec sudo "\$0" "\$@"
case "\${1:-}" in cerebro|modelo|telegram|voz|empresa|grupo) ;; *) echo "Uso: time-do-frank cerebro | modelo | telegram | voz | empresa | grupo"; exit 2 ;; esac
exec bash $DESTINO_PACOTE/instalar.sh --so "\$1" "\${@:2}"
EOF
  chmod 755 /usr/local/bin/time-do-frank
}

# ---------- grupo do time no Telegram: um tópico por agente, todos pelo bot do Frank ----------
GRUPO_PY=/usr/local/lib/time-do-frank/grupo.py
escrever_grupo_py() {
  install -d -m 755 "$(dirname "$GRUPO_PY")"
  cat >"$GRUPO_PY" <<'PY'
#!/usr/bin/env python3
"""Grupo do time no Telegram: um tópico por agente, todos pelo bot do Frank.

grupo.py montar        acha o grupo do dono, cria os tópicos e grava empresa/grupo.json (o instalador chama)
grupo.py rotas         imprime as rotas tópico -> perfil para gateway.profile_routes
grupo.py boas-vindas   cada agente se apresenta no próprio tópico
grupo.py avisar AGENTE TEXTO   escreve no tópico do agente (time-do-frank avisar)
"""
import datetime
import json
import os
import pathlib
import sys
import time
import tempfile
import urllib.error
import urllib.parse
import urllib.request

CASA = pathlib.Path(os.environ.get("TDF_CASA", "/home/hermes"))
ARQUIVO = CASA / "empresa" / "grupo.json"
ENV_FRANK = CASA / ".hermes" / "profiles" / "frank" / ".env"
GERAL = "Frank, peça aqui"
# Perfil, nome do tópico e cor. O Telegram só aceita estas 6 cores de ícone.
TOPICOS = [
    ("ulisses", "Ulisses, estratégia", 7322096),
    ("renata", "Renata, textos", 16766590),
    ("marina", "Marina, páginas", 13338331),
    ("lara", "Lara, posts e Reels", 9367192),
    ("breno", "Breno, anúncios", 16749490),
    ("vitor", "Vitor, atendimento", 16478047),
    ("isabela", "Isabela, números", 7322096),
]
APRESENTACAO = {
    "frank": "Aqui é o Frank. Este tópico é para pedir qualquer coisa ao time: eu divido o trabalho e você vê cada "
             "tarefa chegando no tópico do assistente. Para falar direto com alguém, escreva no tópico dele.",
    "ulisses": "Ulisses aqui, o estrategista. Neste tópico você fala direto comigo: oferta, público, posicionamento e plano de campanha.",
    "renata": "Renata aqui, a copywriter. Neste tópico você fala direto comigo: anúncios, textos de página, e-mails e roteiros.",
    "marina": "Marina aqui, das páginas. Neste tópico você fala direto comigo: páginas de captura e de venda.",
    "lara": "Lara aqui, das redes sociais. Neste tópico você fala direto comigo: posts, carrosséis e roteiros de Reels.",
    "breno": "Breno aqui, do tráfego. Neste tópico você fala direto comigo: anúncios, verba e o que pausar. Nada vai para o ar sem o seu ok.",
    "vitor": "Vitor aqui, do atendimento. Neste tópico você fala direto comigo: respostas para os leads no WhatsApp e no Direct.",
    "isabela": "Isabela aqui, dos números. Neste tópico você fala direto comigo: vendas, investimento e o que está funcionando.",
}


def dizer(texto):
    print(f"    {texto}", flush=True)


def ok(texto):
    print(f"    \033[32mok\033[0m {texto}", flush=True)


def parar(texto):
    print(f"\n\033[1;31mParou: {texto}\033[0m", file=sys.stderr, flush=True)
    sys.exit(1)


def ler_grupo():
    try:
        return json.loads(ARQUIVO.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def token():
    valor = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not valor and ENV_FRANK.is_file():
        for linha in ENV_FRANK.read_text(encoding="utf-8").splitlines():
            if linha.startswith("TELEGRAM_BOT_TOKEN="):
                valor = linha.split("=", 1)[1].strip().strip("\"'")
    return valor


def chamar(base, tok, metodo, espera=40, **args):
    campos = {k: json.dumps(v) if isinstance(v, (dict, list)) else v for k, v in args.items() if v is not None}
    pedido = urllib.request.Request(f"{base}/bot{tok}/{metodo}", data=urllib.parse.urlencode(campos).encode())
    try:
        with urllib.request.urlopen(pedido, timeout=espera) as resposta:
            return json.load(resposta)
    except urllib.error.HTTPError as erro:
        try:
            return json.load(erro)
        except ValueError:
            return {"ok": False, "error_code": erro.code, "description": f"HTTP {erro.code}"}
    except (OSError, ValueError) as erro:
        return {"ok": False, "incerto": True, "description": "a conexão caiu ou a resposta não pôde ser lida"}


def montar():
    base, tok, dono = os.environ["TG_API"], os.environ["TELEGRAM_BOT_TOKEN"], int(os.environ["DONO"])
    limite = time.time() + int(os.environ.get("TEMPO", "900"))
    eu = chamar(base, tok, "getMe")
    if not eu.get("ok"):
        parar("o Telegram recusou o token do bot. Rode: time-do-frank telegram")
    bot = eu["result"]
    print()
    dizer("No Telegram, no celular ou no computador:")
    dizer("1. Crie um grupo novo, por exemplo \"Time da empresa\", e adicione o bot @" + bot.get("username", ""))
    dizer("2. Nas configurações do grupo, ligue Tópicos.")
    dizer("3. Em Administradores, adicione o bot e deixe ligada a permissão Gerenciar tópicos.")
    dizer("4. Escreva no grupo: oi @" + bot.get("username", ""))
    print()
    dizer("Estou esperando o seu oi no grupo (até 15 minutos)...")
    offset, dicas, grupo = None, set(), None
    while grupo is None and time.time() < limite:
        r = chamar(base, tok, "getUpdates", espera=40, offset=offset, timeout=25,
                   allowed_updates=["message", "my_chat_member"])
        if not r.get("ok"):
            time.sleep(3)
            continue
        for update in r.get("result", []):
            offset = update["update_id"] + 1
            msg = update.get("message") or {}
            chat = msg.get("chat") or {}
            if (msg.get("from") or {}).get("id") != dono:
                continue
            tipo = chat.get("type")
            if tipo == "group" and "comum" not in dicas:
                dicas.add("comum")
                dizer("Recebi o oi, mas o grupo ainda está sem Tópicos. Ligue Tópicos nas configurações do grupo e escreva oi de novo.")
            elif tipo == "supergroup" and not chat.get("is_forum") and "forum" not in dicas:
                dicas.add("forum")
                dizer("Recebi o oi, mas os Tópicos estão desligados. Ligue Tópicos nas configurações do grupo e escreva oi de novo.")
            elif tipo == "supergroup" and chat.get("is_forum"):
                grupo = chat
    if grupo is None:
        parar("não recebi o oi no grupo. Confira se o bot está no grupo como administrador e rode de novo: time-do-frank grupo")
    if offset:
        chamar(base, tok, "getUpdates", offset=offset, timeout=0)
    ok(f"grupo encontrado: {grupo.get('title', '')}")

    avisado = False
    while True:
        membro = chamar(base, tok, "getChatMember", chat_id=grupo["id"], user_id=bot["id"]).get("result") or {}
        if membro.get("status") == "creator" or (membro.get("status") == "administrator" and membro.get("can_manage_topics")):
            break
        if time.time() > limite:
            parar("o bot não virou administrador com a permissão Gerenciar tópicos. Ajuste e rode de novo: time-do-frank grupo")
        if not avisado:
            avisado = True
            dizer("O bot ainda não é administrador do grupo com a permissão Gerenciar tópicos. Ajuste no Telegram; eu espero.")
        time.sleep(5)
    ok("bot do Frank é administrador e pode criar tópicos")

    anterior = ler_grupo()
    mesmo = anterior.get("chat_id") == grupo["id"] and anterior.get("bot") == bot.get("username", "")
    estado = anterior if mesmo and "--refazer" not in sys.argv else {
        "chat_id": grupo["id"], "titulo": grupo.get("title", ""), "bot": bot.get("username", ""),
        "api": base, "topicos": {},
    }
    topicos = estado.setdefault("topicos", {})
    def guardar():
        ARQUIVO.parent.mkdir(parents=True, exist_ok=True)
        fd, temporario = tempfile.mkstemp(prefix=".grupo-", dir=ARQUIVO.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as saida:
                json.dump(estado, saida, ensure_ascii=False, indent=2)
                saida.write("\n"); saida.flush(); os.fsync(saida.fileno())
            os.replace(temporario, ARQUIVO)
        finally:
            if os.path.exists(temporario): os.unlink(temporario)
    estado.pop("criacao_pendente", None)  # marca da 0.3.2; rodar de novo só cria o que falta
    for perfil, nome, cor in TOPICOS:
        if perfil in topicos: continue
        r = chamar(base, tok, "createForumTopic", chat_id=grupo["id"], name=nome, icon_color=cor)
        if not r.get("ok"):
            # Cada tópico criado já ficou guardado: rodar de novo continua daqui.
            parar(f"não consegui criar o tópico {nome}. Rode de novo: time-do-frank grupo")
        topicos[perfil] = r["result"]["message_thread_id"]
        guardar()
    # Renomear o Geral é enfeite: se o Telegram recusar, o grupo funciona igual.
    chamar(base, tok, "editGeneralForumTopic", chat_id=grupo["id"], name=GERAL)
    estado["montado_em"] = datetime.datetime.now().isoformat(timespec="seconds"); guardar()
    ok(f"tópicos prontos: {GERAL} e mais {len(topicos)}, um por assistente")


def rotas():
    grupo = ler_grupo()
    if not grupo.get("topicos"):
        parar("o grupo do time ainda não foi montado: time-do-frank grupo")
    # O tópico Geral fica sem rota: mensagem sem rota no bot do Frank fica com o Frank.
    print(json.dumps([{"name": f"grupo-{perfil}", "platform": "telegram", "bot_profile": "frank",
                       "chat_id": str(grupo["chat_id"]), "thread_id": str(fio), "profile": perfil}
                      for perfil, fio in grupo["topicos"].items()]))


def enviar(grupo, perfil, texto):
    campos = {"chat_id": grupo["chat_id"], "text": texto[:4000]}
    if perfil != "frank":
        campos["message_thread_id"] = grupo["topicos"][perfil]
    return chamar(grupo.get("api") or "https://api.telegram.org", token(), "sendMessage", **campos)


def boas_vindas():
    grupo = ler_grupo()
    falhas = [p for p in ["frank", *grupo.get("topicos", {})] if not enviar(grupo, p, APRESENTACAO[p]).get("ok")]
    if falhas:
        parar("não consegui escrever nos tópicos de " + ", ".join(falhas))


def avisar(argumentos):
    if len(argumentos) < 2:
        print('Uso: time-do-frank avisar AGENTE "texto"', file=sys.stderr)
        sys.exit(2)
    perfil, texto = argumentos[0].strip().lower(), " ".join(argumentos[1:]).strip()
    grupo = ler_grupo()
    if not grupo.get("topicos"):
        print("sem grupo do time: nada enviado")
        return
    if perfil != "frank" and perfil not in grupo["topicos"]:
        print(f"agente desconhecido: {perfil}", file=sys.stderr)
        sys.exit(2)
    r = enviar(grupo, perfil, texto)
    if not r.get("ok"):
        print(f"o Telegram recusou: {r.get('description', 'erro')}", file=sys.stderr)
        sys.exit(1)
    print(f"avisado no tópico de {perfil}")


if __name__ == "__main__":
    acao = sys.argv[1] if len(sys.argv) > 1 else ""
    if acao == "montar":
        montar()
    elif acao == "rotas":
        rotas()
    elif acao == "boas-vindas":
        boas_vindas()
    elif acao == "avisar":
        avisar(sys.argv[2:])
    else:
        print(__doc__)
        sys.exit(2)
PY
  chmod 755 "$GRUPO_PY"
}

montar_grupo() {
  [ -n "$TELEGRAM_BOT_TOKEN" ] && [[ "$TELEGRAM_ALLOWED_USERS" =~ ^[0-9]+$ ]] \
    || falha "o Telegram do Frank ainda não está ligado. Rode antes: time-do-frank telegram"
  escrever_grupo_py
  local unidade rotas
  unidade="$(gateway_unidade)"
  # Com o Frank ligado, o gateway pega as mensagens antes de nós. Saindo por qualquer caminho, ele volta.
  if [ -n "$unidade" ] && systemctl is-active --quiet "$unidade"; then
    systemctl stop "$unidade"
    # Expansão imediata guarda a unidade mesmo após sair desta função.
    # shellcheck disable=SC2064
    trap "systemctl start '$unidade' >/dev/null 2>&1 || true" EXIT
  fi
  TG_API="$TG_API" TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" DONO="$TELEGRAM_ALLOWED_USERS" TDF_CASA="$CASA" \
    python3 "$GRUPO_PY" montar || falha "o grupo do time não ficou pronto. Confira o passo 7 do manual e rode de novo: time-do-frank grupo"
  chown "$USUARIO:$USUARIO" "$CASA/empresa/grupo.json"; chmod 640 "$CASA/empresa/grupo.json"
  rotas="$(TDF_CASA="$CASA" python3 "$GRUPO_PY" rotas)"
  como_hermes "hermes config set gateway.profile_routes $(printf '%q' "$rotas")" || falha "não consegui ligar os tópicos aos agentes."
  # Home channel de cada assistente = o tópico dele (sem isso, o Hermes pede /sethome no primeiro pedido).
  local perfil fio chat
  chat="$(TDF_CASA="$CASA" python3 -c 'import json,os; print(json.load(open(os.environ["TDF_CASA"] + "/empresa/grupo.json"))["chat_id"])')"
  while read -r perfil fio; do
    grava_env "$perfil" TELEGRAM_HOME_CHANNEL "$chat"
    grava_env "$perfil" TELEGRAM_HOME_CHANNEL_THREAD_ID "$fio"
  done < <(TDF_CASA="$CASA" python3 -c 'import json,os; [print(p, f) for p, f in json.load(open(os.environ["TDF_CASA"] + "/empresa/grupo.json"))["topicos"].items()]')
  ok "cada tópico ligado ao seu agente"
  if [ -n "$unidade" ]; then
    systemctl start "$unidade" && ok "Frank religado" || falha "não consegui religar o Frank. Veja o registro."
    trap - EXIT
  fi
  sleep 3
  if TDF_CASA="$CASA" python3 "$GRUPO_PY" boas-vindas >>"$LOG" 2>&1; then ok "cada agente se apresentou no tópico dele"
  else aviso "os tópicos estão prontos e ligados; só a apresentação de algum agente não saiu. Pode usar o grupo normalmente."; fi
}

MENSAGEM_ENVIADA=0
PENDENCIAS=()
avisar_no_telegram() { # avisar_no_telegram [texto]: o bot do Frank escreve para o dono (prova de que a VPS chega ao Telegram)
  [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_ALLOWED_USERS" ] || return 0
  local texto="${1:-}"
  if [ -z "$texto" ] && [ -n "$RESPOSTA_DO_FRANK" ]; then
    texto="Oi, $NOME_DO_DONO! Aqui é o Frank. A instalação do seu time terminou. Antes do primeiro pedido, quero conhecer a sua empresa: são umas perguntas rápidas, uma de cada vez. Me responde um oi quando puder começar."
  elif [ -z "$texto" ]; then
    texto="Oi, $NOME_DO_DONO! Aqui é o Frank. O Telegram está ligado, mas eu ainda estou sem cérebro para responder. No terminal da VPS, rode: time-do-frank cerebro"
  fi
  if curl -fsS --max-time 15 "$TG_API/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
       --data-urlencode "chat_id=$TELEGRAM_ALLOWED_USERS" --data-urlencode "text=$texto" >/dev/null 2>&1; then
    MENSAGEM_ENVIADA=1; ok "o Frank mandou uma mensagem para você no Telegram"
  else
    aviso "não consegui mandar mensagem no Telegram agora. Mande um oi para o bot e veja se ele responde."
  fi
}

resumo_final() {
  local ip tg_link
  ip=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  dados_do_cerebro "$CEREBRO"
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && conferir_bot; then tg_link="https://t.me/$BOT_USUARIO"; else tg_link="desligado (ligue com: time-do-frank telegram)"; fi
  local falta=() item
  [ -n "$RESPOSTA_DO_FRANK" ] || falta+=("Cérebro: rode  time-do-frank cerebro  (sem ele, os agentes não respondem)")
  if [ -z "$TELEGRAM_BOT_TOKEN" ]; then falta+=("Telegram: rode  time-do-frank telegram")
  elif [ "$MENSAGEM_ENVIADA" != 1 ]; then falta+=("Telegram: mande um oi para o bot; se ele não responder, rode  time-do-frank telegram"); fi
  falta+=("${PENDENCIAS[@]}")
  if [ ${#falta[@]} -eq 0 ]; then
    printf '\n\033[1;32mPronto, %s! O seu time está instalado e o Frank já respondeu.\033[0m\n\n' "$NOME_DO_DONO"
  else
    printf '\n\033[1;32mInstalado, %s.\033[0m Falta pouco:\n' "$NOME_DO_DONO"
    for item in "${falta[@]}"; do printf '  - %s\n' "$item"; done
    echo
  fi
  printf '  Falar com o Frank:   %s\n' "$tg_link"
  if [ -n "$RESPOSTA_DO_FRANK" ]; then
    printf '  Cérebro:             %s (testado: respondeu)\n' "$NOME_CEREBRO"
  else
    printf '  Cérebro:             %s\n' "$NOME_CEREBRO"
  fi
  [ "$CEREBRO" = depois ] || printf '  Modelo e esforço:    %s, esforço %s (trocar: time-do-frank modelo)\n' "$(nome_do_modelo)" "$(nome_do_esforco "$ESFORCO")"
  if [ "$VOZ_OK" = 1 ]; then
    printf '  Voz:                 ligada; no computador, conecte pelo passo 7 do manual (endereço da VPS: %s)\n' "$ip"
  else
    printf '  Voz (opcional):      time-do-frank voz\n'
  fi
  printf '  Grupo do time:       time-do-frank grupo (um tópico por agente; passo 7 do manual)\n'
  printf '  Trocar depois:       time-do-frank cerebro | modelo | telegram | voz | empresa\n'
  printf '  Registro:            %s\n\n' "$LOG"
  if [ "$MENSAGEM_ENVIADA" = 1 ] && [ -n "$RESPOSTA_DO_FRANK" ]; then printf '  O Frank já te mandou uma mensagem no Telegram. Responda com um oi.\n\n'; fi
  return 0
}

# ====================================================================
[ "$(id -u)" = 0 ] || { echo "Rode como root (no Web Console da Hostinger você já é root)." >&2; exit 1; }
: >>"$LOG"; chmod 600 "$LOG"
# Duas execuções juntas (a linha colada em duas abas) gravariam os mesmos arquivos ao mesmo tempo.
# Trava por PID e hora de início, sem flock: um processo filho que ficasse vivo herdaria o flock e travaria as próximas.
TRAVA=/run/instalador-time-do-frank.pid
inicio_do_processo() { awk '{print $22}' "/proc/$1/stat" 2>/dev/null || true; }
OUTRO=""; OUTRO_INICIO=""
read -r OUTRO OUTRO_INICIO 2>/dev/null <"$TRAVA" || true
if [ -n "$OUTRO" ] && [ "$OUTRO" != "$$" ] && [ -n "$OUTRO_INICIO" ] && [ "$(inicio_do_processo "$OUTRO")" = "$OUTRO_INICIO" ]; then
  falha "já tem uma instalação rodando nesta VPS, provavelmente em outra aba do terminal. Feche esta aba e espere a outra terminar."
fi
printf '%s %s\n' "$$" "$(inicio_do_processo "$$")" >"$TRAVA"
echo "Instalador Time do Frank $VERSAO_INSTALADOR em $(date -Is) ${SO:+(só $SO)}" >>"$LOG"
if [ -n "$ARQUIVO_RESPOSTAS" ]; then
  [ -f "$ARQUIVO_RESPOSTAS" ] && [ ! -L "$ARQUIVO_RESPOSTAS" ] || falha "arquivo de respostas ausente ou inválido. Rode novamente pelo computador."
  case "$(stat -c '%u:%a' "$ARQUIVO_RESPOSTAS")" in 0:600|0:400) ;; *) falha "o arquivo de respostas precisa pertencer ao root, com permissão 600." ;; esac
  CODIGO_RESPOSTAS="$(cat "$ARQUIVO_RESPOSTAS")"
  rm -f -- "$ARQUIVO_RESPOSTAS"
elif [ "$PEDIR_CODIGO" = 1 ] && tem_terminal; then
  ler_oculto CODIGO_RESPOSTAS "Cole o código de respostas do manual e aperte Enter (ele não aparece na tela): "
fi
if [ -n "$CODIGO_RESPOSTAS" ] && [ -z "$SO" ] && aplicar_codigo_de_respostas "$CODIGO_RESPOSTAS"; then
  CODIGO_RESPOSTAS="recebido"
  # Do que ficou guardado, só as chaves internas da API: o resto vale o que o aluno respondeu agora.
  carregar_respostas CHAVE_API_RAIZ CHAVE_API_FRANK
  echo "Respostas recebidas do assistente do manual." >>"$LOG"
else
  if [ -n "$CODIGO_RESPOSTAS" ] && [ -z "$SO" ]; then
    aviso "o código do manual chegou cortado. Sem problema: faço as perguntas aqui mesmo."
  elif [ "$PEDIR_CODIGO" = 1 ] && [ -z "$SO" ]; then
    aviso "sem o código do manual. Sem problema: faço as perguntas aqui mesmo."
  fi
  CODIGO_RESPOSTAS=""
  carregar_respostas
fi

# ---------- uma parte só ----------
if [ -n "$SO" ]; then
  [ -x "$HERMES_BIN" ] && [ -d "$DESTINO_PACOTE/agentes" ] || falha "o Time do Frank ainda não está instalado nesta VPS. Rode o instalador completo."
  case "$SO" in
    empresa)
      passo "Sobre você e a sua empresa"
      editar_empresa; guardar_respostas
      passo "Atualizando os 8 agentes"
      instalar_agentes; gravar_env_do_painel; reiniciar_painel; ligar_gateway ;;
    telegram)
      passo "Telegram do Frank"
      esquecer TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USERS; perguntas_telegram; guardar_respostas
      gravar_telegram; criar_rotinas; ligar_gateway
      # A mensagem diz se o Frank já responde; para isso, uma pergunta curta ao cérebro.
      if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ "$CEREBRO" != depois ]; then testar_cerebro || true; fi
      avisar_no_telegram ;;
    voz)
      passo "Voz do Frank"
      esquecer GEMINI_API_KEY; perguntas_voz; guardar_respostas
      instalar_painel ;;
    cerebro)
      passo "Cérebro dos agentes"
      esquecer CEREBRO CEREBRO_CHAVE CEREBRO_URL MODELO ESFORCO; perguntas_cerebro; guardar_respostas
      dica "Passando o cérebro para os 8 agentes. Leva 1 ou 2 minutos; a tela fica parada, é normal."
      instalar_agentes >/dev/null; aplicar_cerebro
      passo "Ligando e testando o cérebro"
      ligar_cerebro; ligar_gateway
      [ -z "$RESPOSTA_DO_FRANK" ] || avisar_no_telegram "Oi, $NOME_DO_DONO! Aqui é o Frank. Agora estou com cérebro e já consigo responder. Me manda um oi." ;;
    modelo)
      passo "Modelo e esforço dos agentes"
      dados_do_cerebro "$CEREBRO" || true
      [ "$ACESSO" != nenhum ] || falha "o cérebro ainda não está ligado. Rode primeiro: time-do-frank cerebro"
      MODELO_ANTERIOR="$MODELO"
      esquecer MODELO ESFORCO
      if [ "$CEREBRO" = compativel ]; then perguntar MODELO "Nome do modelo, exatamente como o provedor escreve"; else perguntas_modelo; fi
      [ -n "$MODELO" ] || [ "$CEREBRO" = ollama ] || MODELO="${MODELO_FIXO:-$MODELO_ANTERIOR}"
      perguntas_esforco; guardar_respostas
      ok "modelo: $(nome_do_modelo); esforço: $(nome_do_esforco "$ESFORCO")"
      dica "Passando para os 8 agentes. Leva 1 ou 2 minutos; a tela fica parada, é normal."
      instalar_agentes >/dev/null; aplicar_cerebro
      passo "Testando o cérebro"
      ligar_cerebro; ligar_gateway ;;
    grupo)
      passo "Grupo do time no Telegram"
      montar_grupo ;;
  esac
  if [ "$AVISOS" = 0 ]; then printf '\n\033[1;32mPronto.\033[0m\n\n'
  else printf '\n\033[1;33mTerminei, mas leia os avisos acima: cada um diz o que fazer.\033[0m\n\n'; fi
  exit 0
fi

# ---------- 1. conferências ----------
passo "Conferindo o servidor"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || falha "este instalador é para Ubuntu. Encontrado: ${PRETTY_NAME:-desconhecido}."
case "${VERSION_ID:-}" in 24.04|26.04) ;; *) aviso "testado no Ubuntu 24.04 e 26.04; esta máquina tem ${VERSION_ID:-?}." ;; esac
MEM_GB=$(awk '/MemTotal/ {printf "%d", $2/1024/1024 + 0.5}' /proc/meminfo)
[ "$MEM_GB" -ge 7 ] || aviso "a máquina tem ${MEM_GB} GB de memória; o recomendado é 8 GB (KVM 2)."
if ss -ltn 2>/dev/null | awk 'NR>1 {print $4}' | grep -qE ':(80|443)$'; then
  aviso "este servidor já tem um painel ou site ligado (porta 80 ou 443). O recomendado é o Ubuntu puro, sem painel (Plain OS). Sigo mesmo assim."
fi
ok "Ubuntu ${VERSION_ID}, $(uname -m), ${MEM_GB} GB"
[ -n "$CODIGO_RESPOSTAS" ] && ok "respostas do manual recebidas: $NOME_DA_EMPRESA, de $NOME_DO_DONO"

if [ -f "$RESPOSTAS" ] && [ -z "$CODIGO_RESPOSTAS" ] && tem_terminal && [ -n "$NOME_DA_EMPRESA" ]; then
  dados_do_cerebro "$CEREBRO" || true
  echo
  echo "    Encontrei as respostas da instalação anterior: $NOME_DA_EMPRESA, cérebro $NOME_CEREBRO."
  if ! sim_ou_nao "Usar as mesmas respostas? (S/n)" s; then
    esquecer "${EMPRESA[@]}" TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USERS CEREBRO CEREBRO_CHAVE CEREBRO_URL MODELO ESFORCO GEMINI_API_KEY
  fi
fi

passo "Sobre você e a sua empresa"
perguntas_empresa
passo "Telegram do Frank"
perguntas_telegram
passo "Cérebro dos agentes"
perguntas_cerebro
passo "Voz do Frank"
perguntas_voz
guardar_respostas
if tem_terminal; then
  printf '\n    \033[1mAgora é comigo.\033[0m Leva de 10 a 20 minutos. Pode deixar esta janela aberta e pegar um café;\n'
  printf '    se eu precisar de você, aviso com um bipe.\n'
fi

# ---------- sistema e proteção ----------
passo "Atualizando o sistema e instalando o básico (alguns minutos)"
export DEBIAN_FRONTEND=noninteractive
# VPS recém-criada roda a própria atualização nos primeiros minutos e trava o apt. Espera até 15 minutos.
espera=0
while pgrep -x apt-get >/dev/null || pgrep -x apt >/dev/null || pgrep -x dpkg >/dev/null || pgrep -f '^/usr/bin/python3 /usr/bin/unattended-upgrade' >/dev/null; do
  [ "$espera" = 0 ] && echo "    o servidor ainda está terminando a atualização automática dele; aguardando..."
  sleep 5; espera=$((espera + 5))
  [ "$espera" -ge 900 ] && falha "o servidor ficou 15 minutos ocupado com a própria atualização. Reinicie a VPS no painel da Hostinger e rode de novo."
done
[ "$espera" -gt 0 ] && ok "servidor liberado depois de ${espera}s"
APT_OPCOES=(-q -o DPkg::Lock::Timeout=600)
apt-get "${APT_OPCOES[@]}" update >>"$LOG" 2>&1 || falha "não consegui atualizar a lista de pacotes. Confira a internet da VPS e rode de novo."
apt-get "${APT_OPCOES[@]}" install -y git curl tar xz-utils ca-certificates coreutils libatomic1 openssl python3 ufw fail2ban unattended-upgrades >>"$LOG" 2>&1 \
  || falha "não consegui instalar os pacotes do sistema. Rode de novo em alguns minutos."
ok "pacotes do sistema"
EXTRAS="$(escolher_pacotes libnss3 "libatk1.0-0t64|libatk1.0-0" "libatk-bridge2.0-0t64|libatk-bridge2.0-0" "libcups2t64|libcups2" \
  "libatspi2.0-0t64|libatspi2.0-0" libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libcairo2 libpango-1.0-0 \
  "libasound2t64|libasound2" libxkbcommon0 libxi6 libxtst6 xvfb ffmpeg fonts-noto-core fonts-dejavu-core python3-pip python3-venv)"
# shellcheck disable=SC2086
if apt-get "${APT_OPCOES[@]}" install -y $EXTRAS >>"$LOG" 2>&1; then
  ok "programas do navegador, da tela virtual, Python (pip e venv), ffmpeg e fontes com acento"
else
  aviso "não consegui instalar os programas do navegador; o Frank fica sem navegar até você rodar o instalador de novo."
fi
timedatectl set-timezone "$FUSO" >>"$LOG" 2>&1 && ok "relógio do servidor no fuso $FUSO" || aviso "não consegui ajustar o fuso do servidor."
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now fail2ban >>"$LOG" 2>&1 || aviso "não consegui ligar o fail2ban."
ok "atualizações automáticas de segurança e proteção contra tentativas de invasão"
if [ "$FIREWALL" = 1 ]; then
  ufw allow OpenSSH >>"$LOG" 2>&1
  ufw --force enable >>"$LOG" 2>&1
  ok "firewall ligado: só a porta de administração (SSH) fica aberta"
else
  aviso "firewall não alterado (--sem-firewall)."
fi

# ---------- usuário do Hermes ----------
passo "Criando o usuário que vai rodar os agentes"
if ! id "$USUARIO" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$USUARIO"
  ok "usuário $USUARIO criado"
else
  ok "usuário $USUARIO já existe"
fi
loginctl enable-linger "$USUARIO" >>"$LOG" 2>&1 || true
if [ -s /root/.ssh/authorized_keys ] && [ ! -s "$CASA/.ssh/authorized_keys" ]; then
  install -d -o "$USUARIO" -g "$USUARIO" -m 700 "$CASA/.ssh"
  install -o "$USUARIO" -g "$USUARIO" -m 600 /root/.ssh/authorized_keys "$CASA/.ssh/authorized_keys"
  ok "sua chave SSH também vale para o usuário $USUARIO (o painel de voz do computador entra por ela)"
fi

# ---------- Hermes ----------
passo "Instalando o Hermes Agent na versão testada (pode levar 5 a 10 minutos)"
if [ -x "$HERMES_BIN" ]; then
  ok "Hermes já instalado: $(runuser -l "$USUARIO" -c "$HERMES_BIN --version" 2>/dev/null | head -1)"
else
  URL_INSTALADOR="https://raw.githubusercontent.com/NousResearch/hermes-agent/${HERMES_COMMIT}/scripts/install.sh"
  como_hermes "curl -fsSL '$URL_INSTALADOR' | bash -s -- --non-interactive --commit '$HERMES_COMMIT' --skip-browser --skip-computer-use" \
    || falha "a instalação do Hermes não terminou."
  [ -x "$HERMES_BIN" ] || falha "o Hermes não ficou disponível em $HERMES_BIN."
  ok "$(runuser -l "$USUARIO" -c "$HERMES_BIN --version" 2>/dev/null | head -1)"
fi
ln -sf "$HERMES_BIN" /usr/local/bin/hermes
instalar_navegador
instalar_transcricao

# ---------- pacote ----------
passo "Baixando o Frank, os 7 assistentes e o painel de voz"
rm -rf "$DESTINO_PACOTE.novo"; mkdir -p "$DESTINO_PACOTE.novo"
if [ -n "$PACOTE_LOCAL" ]; then
  cp -a "$PACOTE_LOCAL/." "$DESTINO_PACOTE.novo/"
else
  # Arquivo temporário próprio: em /tmp, o root não sobrescreve arquivo de outro usuário (fs.protected_regular).
  PACOTE_BAIXADO="$(mktemp /tmp/time-do-frank.XXXXXX)"
  curl -fsSL --connect-timeout 15 --max-time 600 --retry 3 "$PACOTE_URL" -o "$PACOTE_BAIXADO" || falha "não consegui baixar o pacote dos agentes."
  [ -n "$PACOTE_SHA256" ] || PACOTE_SHA256="$(curl -fsSL --connect-timeout 15 --max-time 60 --retry 3 "$PACOTE_URL.sha256" 2>/dev/null | awk '{print $1}' || true)"
  if [[ "$PACOTE_SHA256" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "$PACOTE_SHA256  $PACOTE_BAIXADO" | sha256sum -c - >>"$LOG" 2>&1 || falha "o pacote baixado não confere. Não instalei nada dele."
  else
    falha "não consegui conferir a integridade do pacote. Confira a internet e rode de novo."
  fi
  tar -xzf "$PACOTE_BAIXADO" -C "$DESTINO_PACOTE.novo"
  rm -f "$PACOTE_BAIXADO"
fi
for a in "${AGENTES[@]}"; do
  [ -f "$DESTINO_PACOTE.novo/agentes/$a/distribution.yaml" ] || falha "o pacote não tem o agente $a."
done
rm -rf "$DESTINO_PACOTE.anterior"
[ ! -e "$DESTINO_PACOTE" ] || mv "$DESTINO_PACOTE" "$DESTINO_PACOTE.anterior"
mv "$DESTINO_PACOTE.novo" "$DESTINO_PACOTE"
# Este instalador será reexecutado como root pelo comando time-do-frank.
chown -R root:root "$DESTINO_PACOTE"
chmod -R go-w "$DESTINO_PACOTE"
[ -f "$DESTINO_PACOTE/instalar.sh" ] && instalar_comando
ok "pacote em $DESTINO_PACOTE"

# ---------- agentes ----------
passo "Instalando os 8 agentes com os dados de $NOME_DA_EMPRESA"
instalar_agentes
aplicar_cerebro
gravar_telegram

# ---------- quadro e rotinas ----------
passo "Ligando o quadro de tarefas e as rotinas"
como_hermes "hermes kanban init" || falha "não consegui criar o quadro de tarefas."
criar_rotinas

# ---------- painel de voz ----------
passo "Ligando o painel de voz"
ligar_api_do_hermes
guardar_respostas
instalar_painel

# ---------- cérebro ----------
passo "Ligando e testando o cérebro"
ligar_cerebro

# ---------- serviço ----------
passo "Deixando o Frank ligado 24 horas"
ligar_tela_virtual
ligar_gateway
dar_tela_ao_frank

# ---------- conferência final ----------
passo "Conferindo"
LISTA_PERFIS="$(runuser -l "$USUARIO" -c "$HERMES_BIN profile list" 2>&1 </dev/null || true)"
printf '%s\n' "$LISTA_PERFIS" >>"$LOG"
N_AGENTES=0
for a in "${AGENTES[@]}"; do grep -q " $a@" <<<"$LISTA_PERFIS" && N_AGENTES=$((N_AGENTES + 1)); done
[ "$N_AGENTES" = "${#AGENTES[@]}" ] && ok "$N_AGENTES agentes instalados: ${AGENTES[*]}" || falha "encontrei $N_AGENTES de ${#AGENTES[@]} agentes. Rode o instalador de novo."
UNIDADE="$(gateway_unidade)"
sleep 3
if [ -n "$UNIDADE" ] && systemctl is-active --quiet "$UNIDADE"; then ok "Frank ligado 24 horas"; else falha "o serviço do Frank não está rodando. Rode o instalador de novo."; fi
CHROME="$(ls "$CASA"/.hermes/tools/chromium-*/*/chrome 2>/dev/null | head -1 || true)"
PAGINA="$( { [ -n "$CHROME" ] && runuser -u "$USUARIO" -- timeout 60 "$CHROME" --headless=new --disable-gpu --dump-dom about:blank 2>/dev/null; } || true)"
if [[ "$PAGINA" == *'<html'* ]]; then ok "navegador do Frank abre páginas"
else aviso "o navegador do Frank não abriu."; PENDENCIAS+=("Navegador do Frank: cole a mesma linha do manual de novo (o que já está pronto fica)"); fi
if systemctl is-active --quiet tela-virtual-do-frank 2>/dev/null; then ok "tela virtual do Computer Use ligada"
else aviso "a tela virtual do Computer Use está desligada."; PENDENCIAS+=("Computer Use: cole a mesma linha do manual de novo"); fi
VOZ_OK=0
if [ -n "$GEMINI_API_KEY" ] && conferir_painel; then VOZ_OK=1; ok "painel de voz respondendo"; fi
avisar_no_telegram
resumo_final

} # fim do instalador completo
