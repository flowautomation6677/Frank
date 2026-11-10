#!/bin/bash
for i in $(seq 1 180); do
  status=$(docker exec flow-automation-frank hermes auth status openai-codex 2>/dev/null || true)
  if echo "$status" | grep -qi "logged in"; then
    echo "Login detectado com sucesso em $(date)!" >> /tmp/codex_setup.log
    docker exec flow-automation-frank hermes config set model.provider "openai-codex" >> /tmp/codex_setup.log 2>&1 || true
    docker exec flow-automation-frank hermes config set model.default "gpt-6-sol" >> /tmp/codex_setup.log 2>&1 || true
    cd /opt/frank && docker compose up -d >> /tmp/codex_setup.log 2>&1
    echo "Codex ativado e container atualizado com sucesso." >> /tmp/codex_setup.log
    exit 0
  fi
  sleep 5
done
echo "Timeout esperando autenticação." >> /tmp/codex_setup.log
exit 1

