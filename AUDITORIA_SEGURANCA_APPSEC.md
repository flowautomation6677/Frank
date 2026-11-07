# Relatório de Conformidade & Hardening de Segurança (AppSec) · Flow Automation
**Projeto:** Time do Frank (Flow Automation Edition)  
**Escopo:** Auditoria Preventiva de Código, Vetores de Ataque em LLM e Blindagem de Infraestrutura  
**Classificações Avaliadas:** CWE-94, CWE-285, CWE-78 | OWASP Top 10 for LLMs (LLM01, LLM08) | OWASP API Security (API1:2023) | SSRF Mitigation  
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
| **Supply Chain e Command Injection (Instaladores)** | CWE-78 / OWASP A08:2021 | **Crítico (9.8)** | 1. **Assinatura SHA-256 Pré-Execução:** O instalador valida o hash criptográfico (`E8B0E5D3...`) antes de executar qualquer binário/script.<br/>2. Conexão restrita a TLS 1.2 e TLS 1.3.<br/>3. **Menor Privilégio:** Execução 100% em `--user-mode`, sem exigir privilégios de Administrador/Root. | **BLINDADO** |
| **Controle de Acesso e IDOR / BOLA (Módulo API / Painel)** | CWE-285 / OWASP API1:2023 | **Alto (8.5)** | 1. **Validação Composta de Posse:** Nas rotas `demandas/[id]` e `turno/[runId]/aprovacao`, a API valida se o recurso pertence estritamente ao `nomeDoDono` configurado.<br/>2. Validação estrita por Regex (`ID_DA_DEMANDA`, `ID_DO_RUN`) impedindo enumeração e injeções.<br/>3. Proteção contra CSRF/Cross-Site Leaks via `Sec-Fetch-Site` e validação de `Origin`. | **BLINDADO** |
| **Integração LLM, SSRF e Prompt Injection** | CWE-94 / OWASP LLM01, LLM08 & SSRF | **Alto (8.2)** | 1. **Validador de SSRF em `http.js`:** Bloqueio estrito de endpoints de metadados de nuvem (`169.254.169.254`, `metadata.google.internal`) e redes privadas.<br/>2. **Delimitadores Fortes nos Agentes:** Instruções em `SOUL.md` tratam textos dentro de `<user_input>` estritamente como dados inertes.<br/>3. **Human-In-The-Loop (HITL):** O subsistema `autorizacao.js` impõe aprovação humana para qualquer comando destrutivo. | **BLINDADO** |
| **Escalação de Privilégios (LPE / Hijacking no Windows)** | CWE-78 / OWASP A08:2021 | **Alto (7.8)** | 1. **Zero-UAC:** O watchdog roda nos limites do usuário comum (`%LOCALAPPDATA%`), sem rodar como `SYSTEM`.<br/>2. O instalador aplica ACLs estritas no Windows via `icacls`, garantindo que apenas o usuário proprietário tenha permissão de gravação nos scripts. | **BLINDADO** |

---

## 3. Detalhamento das Camadas de Proteção Implementadas

### Camada 1: Integridade de Supply Chain (SHA-256)
No script `scripts/instalar-cliente.ps1`:
- Todo download externo de scripts é validado contra o hash esperado:
  ```powershell
  $ExpectedHash = "E8B0E5D378D005A733E2750AF2727F0BBA86378AC9BDB79FC45D06DFE7F36C97"
  $ActualHash = (Get-FileHash -Path $TempInstaller -Algorithm SHA256).Hash
  if ($ActualHash -ne $ExpectedHash) { throw "Falha na validação de integridade SHA-256!" }
  ```
- Isso neutraliza ataques Man-in-the-Middle (MitM) ou comprometimento de servidores de origem.

### Camada 2: Prevenção contra IDOR / BOLA na API Local
No arquivo `painel/functions/_lib/ponte.js`:
- Antes de qualquer leitura ou aprovação de turno, o sistema verifica a identidade do chamador contra o dono da organização:
  ```javascript
  const donoEsperado = nomeDoDono(env);
  if (donoEsperado && demanda.nome && demanda.nome !== donoEsperado) {
    throw new ErroHttp(403, 'Acesso negado: recurso pertence a outra organização (IDOR Protection).');
  }
  ```

### Camada 3: Validação de SSRF e Delimitadores de Prompt (OWASP LLM01)
No arquivo `painel/functions/_lib/http.js`:
- Bloqueamos requisições para `169.254.169.254` (metadados AWS/GCP/Azure) e redes privadas.
Nos arquivos `SOUL.md`:
- Cada agente possui a regra de tratar delimitadores `<user_input>` como dados inertes, impedindo injeções de contexto maliciosas.

### Camada 4: Controle de Acesso ao Sistema de Arquivos (ACLs no Windows)
No script `scripts/instalar-cliente.ps1`:
- Aplicamos remoção de herança de permissões fracas e concedemos acesso exclusivo ao usuário atual e ao SYSTEM:
  ```powershell
  icacls "$PastaFrank" /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F"
  ```

---

*Documento auditado pela engenharia da Flow Automation.*  
*Responsável Técnico: Luiz Antonio*
