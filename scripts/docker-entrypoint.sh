#!/bin/bash
set -e

echo "===================================================================="
echo "    FLOW AUTOMATION · INICIALIZANDO TIME DE AGENTES (DOCKER)        "
echo "===================================================================="

APP_DIR="/app"
HERMES_HOME="${HERMES_HOME:-/home/hermes/.hermes}"
DATA_DIR="${FRANK_PASTA_DE_DADOS:-/app/data}"
BANCO_DIR="${BANCO_DIR:-/home/hermes/empresa/banco}"

mkdir -p "$DATA_DIR/demandas" "$DATA_DIR/logs" "$HERMES_HOME" "$BANCO_DIR"

# Configuração de Ambiente para o Painel Web
export FRANK_HOST="0.0.0.0"
export FRANK_PORTA="8787"
export FRANK_PASTA_DE_DADOS="$DATA_DIR"
export HERMES_HOME="$HERMES_HOME"
export HERMES_BIN="${HERMES_BIN:-/usr/local/bin/hermes}"
export HERMES_API_URL="http://127.0.0.1:8642/p/frank"

# Chave interna do API Gateway se não informada
if [ -z "$HERMES_API_KEY" ]; then
  export HERMES_API_KEY="$(openssl rand -hex 24)"
fi

# Configuração Global do Hermes
export API_SERVER_ENABLED="true"
export API_SERVER_KEY="$HERMES_API_KEY"
export API_SERVER_PORT="8642"
export API_SERVER_HOST="0.0.0.0"

# Gravar .env global do Hermes para persistência interna
cat > "$HERMES_HOME/.env" <<EOF
API_SERVER_ENABLED=true
API_SERVER_KEY=$HERMES_API_KEY
API_SERVER_PORT=8642
API_SERVER_HOST=0.0.0.0
OPENAI_API_KEY=${OPENAI_API_KEY:-}
GEMINI_API_KEY=${GEMINI_API_KEY:-}
GOOGLE_API_KEY=${GEMINI_API_KEY:-}
EOF

# Configurar perfil frank
mkdir -p "$HERMES_HOME/profiles/frank"
cat > "$HERMES_HOME/profiles/frank/.env" <<EOF
API_SERVER_KEY=$HERMES_API_KEY
OPENAI_API_KEY=${OPENAI_API_KEY:-}
GEMINI_API_KEY=${GEMINI_API_KEY:-}
GOOGLE_API_KEY=${GEMINI_API_KEY:-}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
TELEGRAM_ALLOWED_USERS=${TELEGRAM_ALLOWED_USERS:-}
TELEGRAM_HOME_CHANNEL=${TELEGRAM_HOME_CHANNEL:-}
EOF

# Gravar painel.env
mkdir -p /app/painel
cat > /app/painel/painel.env <<EOF
FRANK_HOST=0.0.0.0
FRANK_PORTA=8787
FRANK_PASTA_DE_DADOS=$DATA_DIR
HERMES_BIN=$HERMES_BIN
HERMES_HOME=$HERMES_HOME
HERMES_API_URL=http://127.0.0.1:8642/p/frank
HERMES_API_KEY=$HERMES_API_KEY
FRANK_NOME_DO_DONO=${FRANK_NOME_DO_DONO:-Luiz Antonio}
FRANK_NOME_DA_EMPRESA=${FRANK_NOME_DA_EMPRESA:-Flow Automation}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
GEMINI_API_KEY=${GEMINI_API_KEY:-}
GOOGLE_API_KEY=${GEMINI_API_KEY:-}
FRANK_ACCESS_CODE=${FRANK_ACCESS_CODE:-}
FRANK_ORIGEM_PUBLICA=${FRANK_ORIGEM_PUBLICA:-}
EOF

export FRANK_ENV_FILE="/app/painel/painel.env"

echo "[1/3] Verificando configuração do motor Hermes e registrando agentes..."
if [ -x "$HERMES_BIN" ]; then
  $HERMES_BIN kanban init 2>/dev/null || true
  $HERMES_BIN config set timezone "America/Sao_Paulo" 2>/dev/null || true
  $HERMES_BIN config set display.language "pt" 2>/dev/null || true
  $HERMES_BIN config set stt.language "pt" 2>/dev/null || true
  $HERMES_BIN config set model.provider "gemini" 2>/dev/null || true
  $HERMES_BIN config set model.default "gemini-3.5-flash" 2>/dev/null || true
  $HERMES_BIN config set gateway.multiplex_profiles true 2>/dev/null || true

  # Registrar agentes do time
  for a in frank renata breno marina lara vitor ulisses isabela; do
    if [ -d "$APP_DIR/agentes/$a" ]; then
      if [ ! -d "$HERMES_HOME/profiles/$a" ] || [ ! -f "$HERMES_HOME/profiles/$a/SOUL.md" ]; then
        echo "  + Registrando perfil do agente: $a"
        $HERMES_BIN profile install "$APP_DIR/agentes/$a" --yes 2>/dev/null || true
        if [ -f "$APP_DIR/agentes/$a/DESCRICAO.txt" ]; then
          $HERMES_BIN profile describe "$a" --text "$(cat "$APP_DIR/agentes/$a/DESCRICAO.txt")" 2>/dev/null || true
        fi
      fi
      mkdir -p "$HERMES_HOME/profiles/$a"
      if [ "$a" = "frank" ]; then
        cat > "$HERMES_HOME/profiles/$a/.env" <<EOF
API_SERVER_KEY=$HERMES_API_KEY
OPENAI_API_KEY=${OPENAI_API_KEY:-}
GEMINI_API_KEY=${GEMINI_API_KEY:-}
GOOGLE_API_KEY=${GEMINI_API_KEY:-}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
TELEGRAM_ALLOWED_USERS=${TELEGRAM_ALLOWED_USERS:-}
TELEGRAM_HOME_CHANNEL=${TELEGRAM_HOME_CHANNEL:-}
EOF
      else
        cat > "$HERMES_HOME/profiles/$a/.env" <<EOF
API_SERVER_KEY=$HERMES_API_KEY
OPENAI_API_KEY=${OPENAI_API_KEY:-}
GEMINI_API_KEY=${GEMINI_API_KEY:-}
GOOGLE_API_KEY=${GEMINI_API_KEY:-}
EOF
      fi
    fi
  done
fi

# Inicializar Base de Conhecimento se vazia
if [ ! -f "$BANCO_DIR/empresa.md" ] && [ -f "$APP_DIR/agentes/frank/skills/onboarding-da-empresa/scripts/preparar_banco.py" ]; then
  echo "[2/3] Semeando Base de Conhecimento em $BANCO_DIR..."
  python3 "$APP_DIR/agentes/frank/skills/onboarding-da-empresa/scripts/preparar_banco.py" criar --banco "$BANCO_DIR" 2>/dev/null || true
fi

# Inicializar Banco SQLite Estruturado e Catálogo de Agentes
if [ -f "$APP_DIR/scripts/flow-cli.mjs" ]; then
  echo "-> Inicializando banco SQLite estruturado e migrações ORM..."
  node "$APP_DIR/scripts/flow-cli.mjs" db migrar 2>/dev/null || true
  node "$APP_DIR/scripts/flow-cli.mjs" db seed 2>/dev/null || true
fi

echo "[3/3] Iniciando serviços..."

# Trap para encerramento gracioso
cleanup() {
  echo "Recebido sinal de encerramento. Finalizando processos..."
  kill -TERM "$PID_PAINEL" 2>/dev/null || true
  kill -TERM "$PID_HERMES" 2>/dev/null || true
  wait "$PID_PAINEL" 2>/dev/null || true
  wait "$PID_HERMES" 2>/dev/null || true
  exit 0
}
trap cleanup SIGTERM SIGINT

# Iniciar Hermes Gateway em segundo plano (apenas o perfil frank escuta Telegram)
if [ -x "$HERMES_BIN" ]; then
  echo "-> Iniciando Hermes Gateway na porta 8642..."
  (unset TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USERS TELEGRAM_HOME_CHANNEL; $HERMES_BIN gateway run) &
  PID_HERMES=$!
else
  echo "Aviso: Binário do Hermes não encontrado em $HERMES_BIN. Rodando apenas Painel Web."
  PID_HERMES=0
fi

# Iniciar Painel Web de Voz
echo "-> Iniciando Painel Web de Voz na porta 8787..."
cd /app/painel
node server.mjs &
PID_PAINEL=$!

# Aguardar finalização de processos
wait -n "$PID_PAINEL" "$PID_HERMES"

