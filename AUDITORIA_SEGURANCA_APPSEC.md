# Relatório de Conformidade & Hardening de Segurança (AppSec) · Flow Automation
**Projeto:** Time do Frank (Flow Automation Edition)  
**Escopo:** Auditoria Preventiva de Código, Vetores de Ataque em LLM e Blindagem de Infraestrutura  
**Classificações Avaliadas:** CWE-94, CWE-285, CWE-78 | OWASP Top 10 for LLMs (LLM01, LLM08) | OWASP API Security (API1:2023)  
**Data:** 07 de Novembro de 2026  
**Status de Conformidade:** **HOMOLOGADO & BLINDADO**

---

## 1. Sumário Executivo

A Flow Automation realizou uma auditoria defensiva em nível de engenharia para mapear e mitigar os principais vetores de vulnerabilidade que afetam ecossistemas de agentes autônomos de Inteligência Artificial.

Todas as recomendações de segurança foram implementadas diretamente no código-fonte, garantindo que o produto entregue às clientes atenda aos mais rigorosos padrões de segurança da informação (*Security by Design*).

---

## 2. Matriz de Mitigação de Vulnerabilidades

| Vulnerabilidade / Vetor | Classificação Técnica | Risco Teórico | Arquitetura & Blindagem Implementada | Status |
| :--- | :--- | :---: | :--- | :---: |
| **Execução de Ferramentas por LLM (Prompt Injection to RCE / Data Exfiltration)** | CWE-94 / OWASP LLM01 & LLM08 | **Crítico (9.1)** | 1. O "banco de dados" do Frank não é SQL (não há queries dinâmicas nem risco de SQLi).<br/>2. A skill `consultar-banco` restringe caminhos contra *Directory Traversal*.<br/>3. O arquivo `SOUL.md` de cada agente possui cláusula imutável de rejeição a *Prompt Injection*.<br/>4. O subsistema `autorizacao.js` impõe **Human-In-The-Loop (HITL)** para qualquer comando crítico. | **MITIGADO** |
| **Quebra de Controle de Acesso em Rotas Serverless (BOLA / IDOR / CSRF)** | CWE-285 / OWASP API1:2023 | **Alto (8.5)** | 1. Arquitetura **Single-Tenant Local**: cada cliente possui sua instância isolada em `127.0.0.1`, sem banco compartilhado entre empresas.<br/>2. Validação estrita por Regex (`ID_DA_DEMANDA`, `ID_DO_RUN`) impedindo enumeração e injeções.<br/>3. Proteção contra CSRF/Cross-Site Leaks via `Sec-Fetch-Site` e validação de `Origin` no `_middleware.js`.<br/>4. Injeção de headers de segurança (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`). | **BLINDADO** |
| **Execução Insegura e Escalação de Privilégios (LPE / Hijacking)** | CWE-78 / OWASP A08:2021 | **Alto (7.8)** | 1. **Zero-UAC:** O serviço de watchdog roda estritamente sob os privilégios do usuário padrão (`%LOCALAPPDATA%`), sem rodar como `NT AUTHORITY\SYSTEM`.<br/>2. O instalador aplica ACLs estritas no Windows via `icacls`, garantindo que apenas o usuário proprietário tenha permissão de gravação nos scripts.<br/>3. Repositório desacoplado de links dinâmicos externos (`irm | iex`). | **BLINDADO** |

---

## 3. Detalhamento das Camadas de Proteção Implementadas

### Camada 1: Proteção de Agentes contra Prompt Injection (OWASP LLM01)
Nos arquivos de persona (`SOUL.md`), foi injetado o bloco de diretrizes invioláveis:
- **Resistência a Jailbreak:** O agente é instruído a ignorar comandos de terceiros que tentem anular as regras de negócio.
- **Proteção de Segredos:** É proibido expor arquivos `.env`, chaves de API, senhas ou tokens de provedores.
- **Human-In-The-Loop:** Nenhum comando destrutivo de terminal ou deleção de arquivos é executado sem a confirmação vocal ou clique do operador humano.

### Camada 2: Proteção de Rotas e APIs Locais (OWASP API1:2023)
No arquivo `painel/functions/api/_middleware.js`:
- **Same-Origin Enforcement:** Rejeição de qualquer requisição que venha de domínios externos no navegador, evitando ataques onde um site malicioso tenta disparar requisições para o `localhost:8787`.
- **Timing-Safe Comparison:** O código de acesso (`FRANK_ACCESS_CODE`) utiliza comparação em tempo constante contra ataques de análise de tempo (*Timing Attacks*).
- **Hardening de Headers HTTP:**
  - `X-Content-Type-Options: nosniff` (impede MIME-sniffing);
  - `X-Frame-Options: DENY` (impede clickjacking);
  - `Referrer-Policy: no-referrer` (evita vazamento de URLs no cabeçalho).

### Camada 3: Controle de Acesso ao Sistema de Arquivos (ACLs no Windows)
No script `scripts/instalar-cliente.ps1`:
- Aplicamos remoção de herança de permissões fracas e concedemos acesso exclusivo ao usuário atual e ao SYSTEM:
  ```powershell
  icacls "$PastaFrank" /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F"
  ```
- Isso impede que qualquer processo não privilegiado ou malware de usuário secundário altere o executável do watchdog ou os scripts de automação.

---

*Documento auditado pela engenharia da Flow Automation.*  
*Responsável Técnico: Luiz Antonio*

