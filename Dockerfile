# ==============================================================================
# Flow Automation · Dockerfile Enterprise
# Time de Agentes Autônomos de IA & Painel de Voz
# ==============================================================================

# Estágio 1: Binários do Node.js 22 LTS
FROM node:22-bookworm-slim AS node-bin

# Estágio 2: Runtime Base com Python 3.11 e Node.js
FROM python:3.11-slim-bookworm

LABEL maintainer="Flow Automation <contato@flowautomation.com.br>"
LABEL description="Contêiner de Produção do Time do Frank (Flow Automation Edition)"
LABEL version="1.0.0"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    APP_DIR=/app \
    HERMES_HOME=/home/hermes/.hermes \
    PORT=8787

# Instalar dependências essenciais do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    openssl \
    sqlite3 \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Copiar Node.js do estágio 1
COPY --from=node-bin /usr/local/bin/node /usr/local/bin/node
COPY --from=node-bin /usr/local/bin/npm /usr/local/bin/npm
COPY --from=node-bin /usr/local/lib/node_modules /usr/local/lib/node_modules

# Criar usuário não-privilegiado 'hermes' (Princípio do Menor Privilégio)
RUN groupadd -g 1000 hermes && \
    useradd -u 1000 -g hermes -m -s /bin/bash hermes

# Instalar o motor Hermes Agent sob o usuário hermes
USER hermes
WORKDIR /home/hermes

ENV HERMES_COMMIT=a50406d9b7474b060450d2dcaff8743c977d296a
ENV PATH="/home/hermes/.local/bin:${PATH}"

RUN curl -fsSL "https://raw.githubusercontent.com/NousResearch/hermes-agent/${HERMES_COMMIT}/scripts/install.sh" | \
    bash -s -- --non-interactive --commit "${HERMES_COMMIT}" --skip-browser --skip-computer-use

# Retornar ao root para preparar os diretórios da aplicação
USER root
WORKDIR /app

# Criar estrutura de diretórios da aplicação
RUN mkdir -p /app/data /app/painel /app/agentes /app/scripts /home/hermes/empresa/banco && \
    chown -R hermes:hermes /app /home/hermes

# Copiar código da aplicação
COPY --chown=hermes:hermes package.json /app/package.json
COPY --chown=hermes:hermes agentes/ /app/agentes/
COPY --chown=hermes:hermes painel/ /app/painel/
COPY --chown=hermes:hermes scripts/ /app/scripts/
COPY --chown=hermes:hermes configuracao-cliente.json /app/configuracao-cliente.json

# Garantir permissão de execução no entrypoint
RUN chmod +x /app/scripts/docker-entrypoint.sh && \
    ln -s /home/hermes/.local/bin/hermes /usr/local/bin/hermes || true

# Alternar para o usuário hermes
USER hermes
WORKDIR /app

# Portas de Serviço:
# 8787: Painel Web de Voz em tempo real
# 8642: Hermes API Gateway multiplexado
EXPOSE 8787 8642

# Volumes para persistência de dados
VOLUME ["/app/data", "/home/hermes/.hermes", "/home/hermes/empresa/banco"]

# Healthcheck de Integridade
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8787/api/saude || exit 1

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]

