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

Para instalar em qualquer computador Windows (Windows 10 ou 11):

1. Abra o **PowerShell** no computador da cliente.
2. Clone este repositório ou baixe o pacote:
   ```powershell
   git clone https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
   cd SEU_REPOSITORIO
   ```
3. Execute o instalador automatizado da Flow Automation:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\instalar-cliente.ps1
   ```
4. O instalador solicitará:
   - Nome da Cliente / Responsável
   - Nome da Empresa
   - O que a empresa vende
5. Conecte a inteligência artificial (ChatGPT):
   ```powershell
   hermes auth add openai-codex --type oauth
   ```
   *Um link e um código serão exibidos para autorização rápida no navegador.*
6. **Pronto!** Um atalho **Abrir Frank** será criado automaticamente na Área de Trabalho.

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

