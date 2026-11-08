# Flow Automation · Time de Agentes Autônomos de I.A.

> Plataforma corporativa de múltiplos agentes autônomos baseada no motor [Hermes Agent](https://github.com/NousResearch/hermes-agent), integrada com Telegram, painel de voz local em tempo real, base de conhecimento compartilhada e rotinas de gestão automatizadas.

Desenvolvido e empacotado por **Flow Automation (Luiz Antonio)**.

---

## 👥 Conheça o Time de Agentes

Cada agente possui persona, tom de voz, habilidades (`skills`) e escopo bem definidos:

| Agente | Função | Atribuições Principais |
| :--- | :--- | :--- |
| **Frank** | 👑 Gestor / Líder Geral | Recebe demandas, coordena os outros 7 agentes, delega tarefas no Kanban e envia o resumo diário das operações. |
| **Renata** | ✍️ Copywriter & Redatora | Escreve anúncios persuasivos, cartas de vendas, e-mails, roteiros e propostas comerciais alinhadas à marca. |
| **Breno** | 🎯 Gestor de Tráfego Pago | Analisa campanhas (Meta Ads / Google Ads), identifica gargalos e sugere otimizações no tráfego. |
| **Marina** | 💻 Criadora de Páginas | Estrutura páginas de captura, landing pages e páginas de vendas prontas para conversão. |
| **Lara** | 📱 Reels e Redes Sociais | Cria roteiros dinâmicos para vídeos curtos (Reels/TikTok/Shorts), ganchos e carrosséis. |
| **Vitor** | 💬 Atendimento & SDR | Responde e qualifica leads no WhatsApp e Direct, passando ao dono apenas decisões estratégicas. |
| **Ulisses** | 🧠 Estrategista de Negócios | Analisa posicionamento, concorrentes, esteira de produtos e arquitetura de ofertas. |
| **Isabela** | 📊 Analista de Resultados | Compila métricas diárias (investimento, ROI, conversões e conversas) para o resumo executivo. |

---

## 🏗️ Arquitetura da Solução

```
Flow Automation (Frank)
├── agentes/                # Definições dos 8 agentes (SOUL.md, skills, config.yaml)
├── painel/                 # Servidor do painel de voz Web local (Node.js)
├── scripts/                # Scripts automatizados de instalação e deploy
│   └── instalar-cliente.ps1
├── ~/empresa/banco/        # Base de conhecimento compartilhada da empresa (.md)
└── %LOCALAPPDATA%/hermes/  # Motor de orquestração de IA e perfis
```

---

## 🚀 Instalação Rápida (Para Clientes)

### Opção A: No Windows (Instalador Nativo de 2 Cliques)
1. Baixe o ZIP deste repositório ou clone:
   ```powershell
   git clone https://github.com/flowautomation6677/Frank.git
   cd Frank
   ```
2. Dê **dois cliques** no arquivo `Instalar-Flow-Automation.bat` ou rode no PowerShell:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\instalar-cliente.ps1
   ```
3. O instalador configura os 8 agentes, valida a integridade SHA-256 e cria o atalho `Abrir Frank` na Área de Trabalho.

### Opção B: Via Docker / Nuvem (Linux, macOS, AWS, VPS)
Para rodar em contêiner isolado em qualquer servidor ou computador:
```bash
# 1. Clone o repositório
git clone https://github.com/flowautomation6677/Frank.git
cd Frank

# 2. Inicie com Docker Compose
docker compose up -d
```
*O painel web de voz estará disponível imediatamente em `http://localhost:8787` e a API na porta `8642`.*

---

## 🧪 Engenharia de Qualidade, Testes & CLI Unificada

### Suite de Testes Automatizados (Node.js Test Runner)
O projeto conta com cobertura completa de testes unitários e de integração nativos em Node.js (sem dependências externas):
```bash
# Executa todos os testes unitários e de integração
npm test
```
*Cobrem autorização vocal Human-in-the-Loop (HITL), orquestração de modelos no Hermes, formatação e isolamento de demandas, sanitização de segredos/SSRF e proteção IDOR/BOLA.*

### CLI Unificada Flow Automation (`flow-cli.mjs`)
Consolidação multiplataforma de scripts utilitários (substituindo scripts legados em Python e PowerShell):
```bash
# 1. Diagnóstico completo de integridade dos 8 agentes (Rede, Hermes, Web, Telegram, Fallback, Watchdog)
npm run diagnostico

# 2. Diagnóstico com reparo e auto-cura automática
node scripts/flow-cli.mjs diagnostico --fix

# 3. Gerenciamento do banco de conhecimento da empresa (onboarding)
npm run banco situacao -- --banco ./empresa/banco
npm run banco criar -- --banco ./empresa/banco

# 4. Injeção e atualização de resiliência Multi-LLM (Fallback)
npm run fallback

# 5. Gerenciamento do banco de dados relacional e migrações (ORM SQLite)
npm run db:status
npm run db:migrar
npm run db:seed

# 6. Cofre Centralizado de Segredos (AES-256-GCM)
npm run cofre:status
node scripts/flow-cli.mjs cofre definir GEMINI_API_KEY <sua-chave>
node scripts/flow-cli.mjs cofre definir OPENAI_API_KEY <sua-chave>
node scripts/flow-cli.mjs cofre definir TELEGRAM_BOT_TOKEN <seu-token>

# 7. Menu de ajuda interativo
npm run cli ajuda
```

---

## 🗄️ Gerenciamento de Dados, ORM & Registro Dinâmico de Agentes

### Registro Dinâmico de Agentes (Sem necessidade de commits)
Diferente da arquitetura legada baseada unicamente em pastas e arquivos Markdown estáticos, o sistema agora conta com um **Catálogo Dinâmico de Agentes e Prompts** no SQLite nativo do Node.js:
- **Endpoints REST**:
  - `GET /api/frank/agentes`: Lista agentes e status de ativação.
  - `POST /api/frank/agentes`: Criação dinâmica de novos agentes de IA sem reiniciar o servidor.
  - `GET /api/frank/agentes/:id`: Consulta detalhes, `soul_prompt` e habilidades associadas.
  - `PUT /api/frank/agentes/:id`: Edição em tempo real de personas, prompts de conduta, tom de voz e modelos.
  - `DELETE /api/frank/agentes/:id`: Desativação lógica do agente.
- **Sincronização em Tempo de Execução**: Alterações salvas no banco são automaticamente serializadas para as pastas de perfis do Hermes (`SOUL.md`, `config.yaml`, `DESCRICAO.txt`, `skills/`).

### Controle de Migrações Versionadas (ORM)
- **Engine de Migrações**: Migrações SQL numeradas (`001_schema_inicial.sql`) com controle transacional e verificação de integridade via checksum SHA-256.
- **Tabelas Relacionais Estruturadas**:
  - `agentes` & `agente_skills`: Perfis dinâmicos, prompts de sistema, modelos padrão e habilidades.
  - `conhecimento_empresa`: Base de onboarding estruturada em blocos relacionais, substituindo scripts manuais avulsos.
  - `demandas`: Registro de tarefas, status, entregas e decisões humanas (HITL) com proteção Anti-IDOR nativa.
  - `auditoria_logs`: Trilha de auditoria para rastreabilidade de alterações em agentes e dados.

---

## ⚙️ Pipelines de CI/CD & Auditoria de Segurança
O repositório possui fluxos automatizados do GitHub Actions em `.github/workflows/`:
- **Suite de Testes Automatizados**: Execução contínua de 50 testes unitários e de integração em Node.js 22 LTS.
- **Validação de Sintaxe**: Checagem de JavaScript (Node 22), Python 3.11 e JSONs.
- **Auditoria AppSec**: Varredura contra chaves de API expostas, conferência de hashes SHA-256 de Supply Chain e conformidade OWASP LLM.
- **Docker Build Validation**: Garantia de integridade do contêiner a cada commit.

---

## 🗣️ Painel de Voz e Interação

- **Painel de Voz Local**: Dois cliques no atalho `Abrir Frank` na Área de Trabalho abre o painel web em `http://127.0.0.1:8787`.
- **Telegram (Opcional)**: Caso a cliente deseje atendimento direto pelo celular, configure o token do bot criado no `@BotFather`.
- **Quadro de Tarefas**: O Frank utiliza um Kanban interno (`hermes kanban`) para delegar e acompanhar o trabalho da equipe.

---

## 🔒 Segurança e Boas Práticas

- **Privacidade Total**: O código roda localmente na máquina da cliente ou na VPS dedicada.
- **Isolamento de Chaves**: Nenhuma chave de API ou credencial pessoal é enviada ao repositório (protegido por `.gitignore`).
- **Rotinas Diárias**:
  - `07:30`: Isabela compila os números de vendas e tráfego.
  - `08:00`: Frank entrega o resumo matinal executivo ao dono.

---
© 2026 Flow Automation. Todos os direitos reservados.

