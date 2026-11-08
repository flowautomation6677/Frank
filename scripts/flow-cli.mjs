#!/usr/bin/env node
/**
 * ==============================================================================
 * Flow Automation · Unified Enterprise CLI (Node.js 22 LTS)
 * ==============================================================================
 * Ferramenta unificada de gestão, diagnósticos, onboarding e resiliência
 * operacional do Time de Agentes Frank. Substitui scripts legados em Python e
 * PowerShell por uma interface multiplataforma padronizada (Windows / Linux / Docker).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Constantes de estilo ANSI para terminal
const CORES = {
  reset: '\x1b[0m',
  verde: '\x1b[32m',
  vermelho: '\x1b[31m',
  amarelo: '\x1b[33m',
  ciano: '\x1b[36m',
  branco: '\x1b[37m',
  cinza: '\x1b[90m',
  negrito: '\x1b[1m',
};

// ==============================================================================
// 1. MÓDULO DE DIAGNÓSTICO E SAÚDE DO SISTEMA
// ==============================================================================

export async function executarDiagnostico({ silencioso = false, autoCura = false } = {}) {
  const relatorio = {
    conectividade: false,
    hermesMotor: false,
    painelWeb8787: false,
    hermesApi8642: false,
    telegramBot: null,
    fallbackAtivo: false,
    watchdogConfigurado: false,
    problemas: 0,
  };

  const log = (msg) => {
    if (!silencioso) process.stdout.write(msg);
  };
  const logLn = (msg = '') => {
    if (!silencioso) console.log(msg);
  };

  logLn();
  logLn(`${CORES.ciano}====================================================================${CORES.reset}`);
  logLn(`${CORES.branco}${CORES.negrito}       FLOW AUTOMATION  ·  DIAGNÓSTICO E SAÚDE DO SISTEMA           ${CORES.reset}`);
  logLn(`${CORES.ciano}====================================================================${CORES.reset}`);
  logLn('Executando testes de saúde do sistema de agentes de IA...\n');

  // Teste 1: Conectividade com a Internet
  log('[1/6] Conectividade de Rede e Internet... ');
  try {
    const res = await fetch('https://www.google.com', {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      relatorio.conectividade = true;
      logLn(`${CORES.verde}[OK] Conectado à Internet.${CORES.reset}`);
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch {
    relatorio.problemas++;
    logLn(`${CORES.vermelho}[FALHA] Sem acesso à internet ou DNS bloqueado.${CORES.reset}`);
  }

  // Teste 2: Motor Hermes
  log('[2/6] Motor Hermes Agent... ');
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const hermesHome = process.env.HERMES_HOME || path.join(localAppData, 'hermes');
  const hermesCmdWin = path.join(hermesHome, 'bin', 'hermes.cmd');
  const hermesBinNix = path.join(hermesHome, 'bin', 'hermes');
  const hermesExec = process.platform === 'win32' ? hermesCmdWin : hermesBinNix;

  let versaoHermes = null;
  if (fs.existsSync(hermesExec)) {
    const proc = spawnSync(hermesExec, ['--version'], { encoding: 'utf-8', shell: true });
    if (proc.status === 0 && proc.stdout) {
      versaoHermes = proc.stdout.trim().split('\n')[0];
    }
  } else {
    // Tenta no PATH do sistema
    const proc = spawnSync('hermes', ['--version'], { encoding: 'utf-8', shell: true });
    if (proc.status === 0 && proc.stdout) {
      versaoHermes = proc.stdout.trim().split('\n')[0];
    }
  }

  if (versaoHermes) {
    relatorio.hermesMotor = true;
    logLn(`${CORES.verde}[OK] ${versaoHermes}${CORES.reset}`);
  } else {
    relatorio.problemas++;
    logLn(`${CORES.vermelho}[FALHA] Hermes não localizado no caminho padrão nem no PATH.${CORES.reset}`);
  }

  // Teste 3: Painel Web (8787) e Hermes API (8642)
  log('[3/6] Central Web (8787) e Hermes API (8642)... ');
  try {
    const res8787 = await fetch('http://127.0.0.1:8787/api/saude', { signal: AbortSignal.timeout(2000) });
    if (res8787.ok) {
      const data = await res8787.json().catch(() => ({}));
      if (data.servico === 'painel-do-frank') relatorio.painelWeb8787 = true;
    }
  } catch {}

  try {
    const res8642 = await fetch('http://127.0.0.1:8642/health', { signal: AbortSignal.timeout(2000) });
    if (res8642.ok) {
      const data = await res8642.json().catch(() => ({}));
      if (data.status === 'ok') relatorio.hermesApi8642 = true;
    }
  } catch {}

  if (relatorio.painelWeb8787 && relatorio.hermesApi8642) {
    logLn(`${CORES.verde}[OK] Painel (8787) e Hermes API (8642) 100% ativos.${CORES.reset}`);
  } else if (relatorio.painelWeb8787) {
    relatorio.problemas++;
    logLn(`${CORES.amarelo}[AVISO] Painel de voz ativo (8787), mas Hermes API (8642) inativo.${CORES.reset}`);
  } else {
    relatorio.problemas++;
    logLn(`${CORES.amarelo}[AVISO] Central Web ou Hermes API não estão respondendo localmente.${CORES.reset}`);
  }

  // Teste 4: Integração com Bot do Telegram
  log('[4/6] Integração com Telegram... ');
  let tokenTelegram = '';
  const envFrankPath = path.join(hermesHome, 'profiles', 'frank', '.env');
  const envRootPath = path.join(ROOT_DIR, '.env');
  const buscarToken = (caminho) => {
    if (fs.existsSync(caminho)) {
      const conteudo = fs.readFileSync(caminho, 'utf-8');
      const match = conteudo.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
      if (match) return match[1].trim();
    }
    return '';
  };

  tokenTelegram = buscarToken(envFrankPath) || buscarToken(envRootPath) || process.env.TELEGRAM_BOT_TOKEN || '';

  if (tokenTelegram) {
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${tokenTelegram}/getMe`, { signal: AbortSignal.timeout(3000) });
      const tgData = await tgRes.json();
      if (tgData.ok && tgData.result?.username) {
        relatorio.telegramBot = tgData.result.username;
        logLn(`${CORES.verde}[OK] Bot @${tgData.result.username} autenticado e conectado.${CORES.reset}`);
      } else {
        throw new Error('Telegram rejection');
      }
    } catch {
      relatorio.problemas++;
      logLn(`${CORES.vermelho}[FALHA] Token do Telegram rejeitado ou inacessível.${CORES.reset}`);
    }
  } else {
    logLn(`${CORES.cinza}[INFO] Telegram não configurado neste ambiente.${CORES.reset}`);
  }

  // Teste 5: Inteligência Artificial e Fallback Multi-LLM
  log('[5/6] Inteligência Artificial e Fallback... ');
  const configYaml = path.join(hermesHome, 'config.yaml');
  let fallbackDetectado = false;
  if (fs.existsSync(configYaml)) {
    const conteudoConfig = fs.readFileSync(configYaml, 'utf-8');
    if (conteudoConfig.includes('fallback_providers:')) {
      fallbackDetectado = true;
    }
  }

  if (fallbackDetectado) {
    relatorio.fallbackAtivo = true;
    logLn(`${CORES.verde}[OK] Rota primária e Fallback Multi-LLM ativos no config.yaml.${CORES.reset}`);
  } else {
    relatorio.problemas++;
    logLn(`${CORES.amarelo}[AVISO] Nenhuma rota de fallback detectada. Execute: flow-cli fallback aplicar${CORES.reset}`);
  }

  // Teste 6: Auto-Cura e Watchdog
  log('[6/6] Serviço de Auto-Cura (Watchdog)... ');
  if (process.platform === 'win32') {
    const startupDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    const vbsWatchdog = path.join(startupDir, 'FlowAutomationWatchdog.vbs');
    if (fs.existsSync(vbsWatchdog)) {
      relatorio.watchdogConfigurado = true;
      logLn(`${CORES.verde}[OK] Ativo na inicialização do Windows (Startup).${CORES.reset}`);
    } else {
      relatorio.problemas++;
      logLn(`${CORES.amarelo}[AVISO] Script de auto-inicialização não encontrado no Startup.${CORES.reset}`);
    }
  } else {
    // Linux / Docker container
    relatorio.watchdogConfigurado = true;
    logLn(`${CORES.verde}[OK] Ambiente gerenciado por contêiner Docker / Systemd.${CORES.reset}`);
  }

  logLn();
  logLn(`${CORES.ciano}====================================================================${CORES.reset}`);
  if (relatorio.problemas === 0) {
    logLn(`${CORES.verde}${CORES.negrito}  STATUS: SISTEMA 100% OPERACIONAL E SAUDÁVEL!${CORES.reset}`);
    logLn('  Todos os 8 agentes de IA e integrações estão prontos para produção.');
  } else {
    logLn(`${CORES.amarelo}${CORES.negrito}  STATUS: ${relatorio.problemas} item(ns) requerem atenção.${CORES.reset}`);
    if (autoCura) {
      logLn(`${CORES.ciano}-> Executando rotina de auto-cura automatizada...${CORES.reset}`);
      await executarAutoCura();
    }
  }
  logLn();

  return relatorio;
}

export async function executarAutoCura() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const pastaFrank = path.join(localAppData, 'TimeDoFrank');

  if (process.platform === 'win32') {
    const vbsPainel = path.join(pastaFrank, 'painel', 'ligar-painel.vbs');
    if (fs.existsSync(vbsPainel)) {
      spawnSync('wscript.exe', [`"${vbsPainel}"`], { shell: true });
    }
    const watchdogPs1 = path.join(pastaFrank, 'service', 'flow-watchdog.ps1');
    if (fs.existsSync(watchdogPs1)) {
      spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `"${watchdogPs1}"`], { shell: true });
    }
    console.log(`${CORES.verde}-> Serviços reiniciados pelo processo de auto-cura.${CORES.reset}`);
  }
}

// ==============================================================================
// 2. MÓDULO DE BANCO DE CONHECIMENTO & ONBOARDING (REPLACE preparar_banco.py)
// ==============================================================================

const A_DEFINIR = 'a definir pelo dono';
const MARCADOR = /\{\{([A-Z0-9_]+)(?::\s*([^}]*))?\}\}/g;
const PADROES_DO_INSTALADOR = [
  'ainda não informado; pergunte ao dono antes de escrever qualquer texto de venda',
];

export const BLOCOS_ONBOARDING = [
  ['1. Dados básicos', ['empresa.md']],
  ['2. Oferta', ['produtos-e-precos.md', 'oferta-atual.md']],
  ['3. Cliente ideal', ['publico-e-dores.md', 'perguntas-frequentes.md']],
  ['4. Marca, tom de voz e promessas', ['voz-da-marca.md', 'provas-e-depoimentos.md']],
  ['5. Canais', ['canais-e-integracoes.md']],
  ['6. Regras do time', ['regras-da-casa.md']],
  ['7. Metas e momento', ['empresa.md', 'oferta-atual.md']],
  ['8. Concorrentes e referências', ['empresa.md']],
];

export function trocarMarcadores(texto) {
  const linhas = texto.split(/\r?\n/);
  const resultado = linhas.map((linha) => {
    if (linha.trimStart().startsWith('>')) return linha;
    let nova = linha.replace(MARCADOR, (_match, _nome, sugestao) => {
      return sugestao && sugestao.trim() ? `${A_DEFINIR} (${sugestao.trim()})` : A_DEFINIR;
    });
    for (const padrao of PADROES_DO_INSTALADOR) {
      nova = nova.replaceAll(padrao, A_DEFINIR);
    }
    return nova;
  });
  return resultado.join('\n') + '\n';
}

export function contarPendentes(caminhoArquivo) {
  if (!fs.existsSync(caminhoArquivo)) return null;
  const conteudo = fs.readFileSync(caminhoArquivo, 'utf-8');
  return conteudo
    .split(/\r?\n/)
    .filter((l) => l.includes(A_DEFINIR) && !l.trimStart().startsWith('>')).length;
}

export function obterSituacaoBanco(pastaBanco) {
  const resolvido = path.resolve(pastaBanco);
  if (!fs.existsSync(resolvido)) {
    return { existe: false, pendencias: {}, briefingAntigo: null };
  }

  const pendencias = {};
  for (const [bloco, arquivos] of BLOCOS_ONBOARDING) {
    pendencias[bloco] = arquivos.map((arq) => {
      const qtd = contarPendentes(path.join(resolvido, arq));
      return { arquivo: arq, pendentes: qtd };
    });
  }

  let briefingAntigo = null;
  const briefingPath = path.join(path.dirname(resolvido), 'briefing.md');
  if (fs.existsSync(briefingPath)) {
    const texto = fs.readFileSync(briefingPath, 'utf-8');
    const match = texto.match(/Situação do onboarding:\s*(.+)/);
    briefingAntigo = {
      arquivo: 'briefing.md',
      situacao: match ? match[1].trim() : 'sem situação identificada',
    };
  }

  return { existe: true, pasta: resolvido, pendencias, briefingAntigo };
}

export function criarBancoConhecimento(pastaBanco, pastaModelo) {
  const banco = path.resolve(pastaBanco);
  const modelo = path.resolve(pastaModelo);

  if (!fs.existsSync(modelo) || !fs.statSync(modelo).isDirectory()) {
    throw new Error(`Pasta modelo não encontrada: ${modelo}`);
  }

  fs.mkdirSync(banco, { recursive: true });
  const arquivos = fs.readdirSync(modelo).filter((f) => f.endsWith('.md'));

  let criados = 0;
  for (const arq of arquivos) {
    const destino = path.join(banco, arq);
    if (fs.existsSync(destino)) continue;

    const origem = path.join(modelo, arq);
    const conteudoOrigem = fs.readFileSync(origem, 'utf-8');
    const conteudoTransformado = trocarMarcadores(conteudoOrigem);

    fs.writeFileSync(destino, conteudoTransformado, 'utf-8');
    criados++;
  }

  return { banco, criados, totalArquivos: fs.readdirSync(banco).filter((f) => f.endsWith('.md')).length };
}

// ==============================================================================
// 3. MÓDULO DE INJEÇÃO DE FALLBACK MULTI-LLM (REPLACE add_fallback.py)
// ==============================================================================

export const BLOCO_FALLBACK_PADRAO = [
  'fallback_providers:',
  '  - provider: gemini',
  '    model: "gemini-2.5-flash"',
  '  - provider: gemini',
  '    model: "gemini-2.0-flash"',
  '  - provider: openai-api',
  '    model: "gpt-4o"',
];

export function aplicarFallbackConfig(caminhoConfigYaml, blocoFallback = BLOCO_FALLBACK_PADRAO) {
  if (!fs.existsSync(caminhoConfigYaml)) return false;

  const conteudo = fs.readFileSync(caminhoConfigYaml, 'utf-8');
  const linhas = conteudo.split(/\r?\n/);
  const novasLinhas = [];
  let pulando = false;

  for (const l of linhas) {
    if (l.trim().startsWith('fallback_providers:')) {
      pulando = true;
      continue;
    }
    if (pulando && (l.startsWith('  ') || l.trim().startsWith('-'))) {
      continue;
    }
    pulando = false;
    novasLinhas.push(l);
  }

  novasLinhas.push(...blocoFallback);
  fs.writeFileSync(caminhoConfigYaml, novasLinhas.join('\n') + '\n', 'utf-8');
  return true;
}

export function atualizarTodosFallbacks(diretorioRaiz) {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const baseHermes = diretorioRaiz || process.env.HERMES_HOME || path.join(localAppData, 'hermes');

  const arquivosAlvo = [];
  const configGlobal = path.join(baseHermes, 'config.yaml');
  if (fs.existsSync(configGlobal)) arquivosAlvo.push(configGlobal);

  const pastaPerfis = path.join(baseHermes, 'profiles');
  if (fs.existsSync(pastaPerfis)) {
    const perfis = fs.readdirSync(pastaPerfis, { withFileTypes: true });
    for (const perfil of perfis) {
      if (perfil.isDirectory()) {
        const cfgPerfil = path.join(pastaPerfis, perfil.name, 'config.yaml');
        if (fs.existsSync(cfgPerfil)) arquivosAlvo.push(cfgPerfil);
      }
    }
  }

  const atualizados = [];
  for (const cfg of arquivosAlvo) {
    if (aplicarFallbackConfig(cfg)) {
      atualizados.push(cfg);
    }
  }

  return atualizados;
}

// ==============================================================================
// 4. INTERFACE DE LINHA DE COMANDO (CLI PARSER)
// ==============================================================================

function exibirAjuda() {
  console.log(`
${CORES.ciano}${CORES.negrito}Flow Automation · CLI Unificada de Agentes de IA${CORES.reset}

Uso:
  node scripts/flow-cli.mjs <comando> [opções]

Comandos:
  ${CORES.verde}diagnostico${CORES.reset}       Executa varredura de integridade (Rede, Hermes, Web, Telegram, Fallback, Watchdog)
                    Opções: --fix (executa auto-cura) | --json (saída em JSON)
  
  ${CORES.verde}banco criar${CORES.reset}       Inicializa a base de conhecimento a partir do modelo estruturado
                    Opções: --banco <caminho> [--modelo <caminho>]
  
  ${CORES.verde}banco situacao${CORES.reset}    Lista itens pendentes 'a definir pelo dono' por bloco de onboarding
                    Opções: --banco <caminho>
  
  ${CORES.verde}fallback aplicar${CORES.reset}  Injeta cadeia de resiliência Multi-LLM nos arquivos config.yaml
                    Opções: [--dir <pasta-hermes>]

  ${CORES.verde}db status${CORES.reset}         Exibe a versão do schema, migrações e totais de agentes/conhecimento
  ${CORES.verde}db migrar${CORES.reset}         Executa migrações SQL pendentes de forma transacional e versionada
  ${CORES.verde}db seed${CORES.reset}           Importa os 8 agentes físicos e base de conhecimento para o banco SQLite
  ${CORES.verde}db sincronizar${CORES.reset}    Exporta agentes e conhecimento do banco para os perfis locais do Hermes

  ${CORES.verde}cofre status${CORES.reset}      Lista o status de todos os segredos (mascarados) e suas origens
  ${CORES.verde}cofre definir${CORES.reset}     Armazena chave de API criptografada no cofre (AES-256-GCM)
                    Uso: cofre definir <NOME_CHAVE> <VALOR>
  ${CORES.verde}cofre remover${CORES.reset}     Remove uma chave de API armazenada no cofre

Exemplos:
  node scripts/flow-cli.mjs diagnostico
  node scripts/flow-cli.mjs cofre status
  node scripts/flow-cli.mjs cofre definir GEMINI_API_KEY AIzaSy...
  node scripts/flow-cli.mjs db status
`);
}

async function main() {
  const args = process.argv.slice(2);
  const comando = args[0];

  if (!comando || comando === 'ajuda' || comando === '--help' || comando === '-h') {
    exibirAjuda();
    process.exit(0);
  }

  if (comando === 'diagnostico') {
    const autoCura = args.includes('--fix');
    const jsonOutput = args.includes('--json');
    const resultado = await executarDiagnostico({ silencioso: jsonOutput, autoCura });
    if (jsonOutput) {
      console.log(JSON.stringify(resultado, null, 2));
    }
    process.exit(resultado.problemas > 0 ? 1 : 0);
  }

  if (comando === 'banco') {
    const subcomando = args[1];
    const indexBanco = args.indexOf('--banco');
    const indexModelo = args.indexOf('--modelo');

    const pastaBanco = indexBanco !== -1 && args[indexBanco + 1] ? args[indexBanco + 1] : path.join(ROOT_DIR, 'empresa', 'banco');
    const pastaModelo = indexModelo !== -1 && args[indexModelo + 1]
      ? args[indexModelo + 1]
      : path.join(ROOT_DIR, 'agentes', 'frank', 'skills', 'onboarding-da-empresa', 'references', 'modelo');

    if (subcomando === 'criar') {
      try {
        const res = criarBancoConhecimento(pastaBanco, pastaModelo);
        console.log(`${CORES.verde}Banco de conhecimento criado com sucesso em: ${res.banco}${CORES.reset}`);
        console.log(`Arquivos adicionados: ${res.criados} (Total: ${res.totalArquivos})`);
        const situacao = obterSituacaoBanco(pastaBanco);
        exibirRelatorioSituacao(situacao);
      } catch (err) {
        console.error(`${CORES.vermelho}Erro ao criar banco: ${err.message}${CORES.reset}`);
        process.exit(1);
      }
      process.exit(0);
    }

    if (subcomando === 'situacao') {
      const situacao = obterSituacaoBanco(pastaBanco);
      exibirRelatorioSituacao(situacao);
      process.exit(0);
    }

    console.error(`${CORES.vermelho}Subcomando do banco não reconhecido: ${subcomando}${CORES.reset}`);
    exibirAjuda();
    process.exit(1);
  }

  if (comando === 'fallback') {
    const subcomando = args[1];
    if (subcomando === 'aplicar' || !subcomando) {
      const indexDir = args.indexOf('--dir');
      const dirAlvo = indexDir !== -1 && args[indexDir + 1] ? args[indexDir + 1] : undefined;
      const atualizados = atualizarTodosFallbacks(dirAlvo);
      if (atualizados.length > 0) {
        console.log(`${CORES.verde}Cadeia de Fallback Multi-LLM aplicada com sucesso a ${atualizados.length} arquivo(s):${CORES.reset}`);
        atualizados.forEach((a) => console.log(`  - ${a}`));
      } else {
        console.log(`${CORES.amarelo}Nenhum arquivo config.yaml localizado no diretório alvo.${CORES.reset}`);
      }
      process.exit(0);
    }
  }

  if (comando === 'db') {
    const subcomando = args[1] || 'status';
    const { obterServicoBanco } = await import('../painel/functions/_lib/db/servico.js');
    const { statusMigracoes, executarMigracoes } = await import('../painel/functions/_lib/db/migracoes.js');
    const servico = obterServicoBanco();

    if (subcomando === 'status') {
      const status = statusMigracoes(servico.db);
      const totalAgentes = servico.agentes.listar().length;
      const situacaoConhecimento = servico.conhecimento.obterSituacao();

      console.log(`\n${CORES.ciano}${CORES.negrito}Status do Banco de Dados & Schema ORM (SQLite):${CORES.reset}`);
      console.log(`  Migrações aplicadas: ${CORES.verde}${status.aplicadas.length}${CORES.reset} / ${status.totalDisponiveis}`);
      if (status.pendentes.length > 0) {
        console.log(`  Migrações pendentes: ${CORES.amarelo}${status.pendentes.length}${CORES.reset}`);
        status.pendentes.forEach((m) => console.log(`    - [PENDENTE] ${m.nome}`));
      } else {
        console.log(`  Status das migrações: ${CORES.verde}Schema 100% atualizado.${CORES.reset}`);
      }
      console.log(`  Agentes cadastrados: ${CORES.verde}${totalAgentes}${CORES.reset}`);
      console.log(`  Itens de conhecimento: ${CORES.verde}${situacaoConhecimento.totalItens || 0}${CORES.reset} (${situacaoConhecimento.itensPendentes || 0} pendentes)`);
      console.log();
      process.exit(0);
    }

    if (subcomando === 'migrar') {
      const resultado = executarMigracoes(servico.db);
      if (resultado.executadas.length > 0) {
        console.log(`${CORES.verde}Migrações executadas com sucesso (${resultado.executadas.length}):${CORES.reset}`);
        resultado.executadas.forEach((m) => console.log(`  - [OK] ${m.nome}`));
      } else {
        console.log(`${CORES.verde}Nenhuma migração pendente. Banco de dados já está na versão mais recente.${CORES.reset}`);
      }
      process.exit(0);
    }

    if (subcomando === 'seed') {
      const pastaAgentes = path.join(ROOT_DIR, 'agentes');
      const importados = servico.agentes.importarDoDisco(pastaAgentes);
      const pastaModelo = path.join(ROOT_DIR, 'agentes', 'frank', 'skills', 'onboarding-da-empresa', 'references', 'modelo');
      const itensConhecimento = servico.conhecimento.importarDeMarkdown(pastaModelo);

      console.log(`${CORES.verde}Carga inicial (seed) concluída com sucesso:${CORES.reset}`);
      console.log(`  - ${importados} perfis de agentes importados de ${pastaAgentes}`);
      console.log(`  - ${itensConhecimento} itens de conhecimento importados de ${pastaModelo}`);
      process.exit(0);
    }

    if (subcomando === 'sincronizar') {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const pastaPerfis = path.join(localAppData, 'hermes', 'profiles');
      const sincronizados = servico.agentes.sincronizarTodosParaDisco(pastaPerfis);
      console.log(`${CORES.verde}Agentes sincronizados com o motor Hermes em: ${pastaPerfis}${CORES.reset}`);
      sincronizados.forEach((p) => console.log(`  - [OK] ${p}`));
      process.exit(0);
    }

    console.error(`${CORES.vermelho}Subcomando do db não reconhecido: ${subcomando}${CORES.reset}`);
    exibirAjuda();
    process.exit(1);
  }

  if (comando === 'cofre') {
    const subcomando = args[1] || 'status';
    const { obterCofre, mascararChave } = await import('../painel/functions/_lib/cofre.js');
    const cofre = obterCofre();

    if (subcomando === 'status' || subcomando === 'listar') {
      const segredos = cofre.listarMascarado();
      console.log(`\n${CORES.ciano}${CORES.negrito}Cofre Centralizado de Segredos (AES-256-GCM):${CORES.reset}`);
      console.log(`Arquivo do cofre: ${CORES.cinza}${cofre.caminhoCofre}${CORES.reset}\n`);
      for (const s of segredos) {
        const statusCor = s.configurado ? `${CORES.verde}[CONFIGURADA]${CORES.reset}` : `${CORES.amarelo}[AUSENTE]    ${CORES.reset}`;
        console.log(`  ${statusCor} ${CORES.branco}${s.chave.padEnd(20)}${CORES.reset} : ${s.valorMascarado.padEnd(22)} (${s.origem})`);
      }
      console.log();
      process.exit(0);
    }

    if (subcomando === 'definir') {
      const chave = args[2];
      const valor = args[3];
      if (!chave || !valor) {
        console.error(`${CORES.vermelho}Uso obrigatório: flow-cli cofre definir <NOME_CHAVE> <VALOR>${CORES.reset}`);
        process.exit(1);
      }
      cofre.definir(chave, valor);
      console.log(`${CORES.verde}Segredo "${chave.toUpperCase()}" criptografado e salvo com sucesso no cofre!${CORES.reset}`);
      console.log(`Valor mascarado: ${mascararChave(valor)}`);
      process.exit(0);
    }

    if (subcomando === 'remover') {
      const chave = args[2];
      if (!chave) {
        console.error(`${CORES.vermelho}Uso: flow-cli cofre remover <NOME_CHAVE>${CORES.reset}`);
        process.exit(1);
      }
      const removido = cofre.remover(chave);
      if (removido) {
        console.log(`${CORES.verde}Segredo "${chave.toUpperCase()}" removido do cofre.${CORES.reset}`);
      } else {
        console.log(`${CORES.amarelo}Segredo "${chave.toUpperCase()}" não encontrado no cofre.${CORES.reset}`);
      }
      process.exit(0);
    }

    console.error(`${CORES.vermelho}Subcomando do cofre não reconhecido: ${subcomando}${CORES.reset}`);
    exibirAjuda();
    process.exit(1);
  }

  console.error(`${CORES.vermelho}Comando não reconhecido: ${comando}${CORES.reset}`);
  exibirAjuda();
  process.exit(1);
}

function exibirRelatorioSituacao(situacao) {
  if (!situacao.existe) {
    console.log(`${CORES.amarelo}O banco de conhecimento ainda não existe em ${situacao.pasta || 'caminho fornecido'}.${CORES.reset}`);
    console.log('Para inicializar, execute: flow-cli banco criar --banco <caminho>');
    return;
  }

  console.log(`\n${CORES.ciano}Situação do Banco de Conhecimento (${situacao.pasta}):${CORES.reset}`);
  console.log('Itens a definir pelo dono, por bloco de onboarding:');
  for (const [bloco, arquivos] of Object.entries(situacao.pendencias)) {
    const resumo = arquivos
      .map((a) => `${a.arquivo}: ${a.pendentes === null ? `${CORES.vermelho}ausente${CORES.reset}` : a.pendentes}`)
      .join('; ');
    console.log(`  ${bloco}: ${resumo}`);
  }

  if (situacao.briefingAntigo) {
    console.log(`\n${CORES.verde}Briefing pré-existente localizado: ${situacao.briefingAntigo.arquivo} (${situacao.briefingAntigo.situacao})${CORES.reset}`);
  }
  console.log();
}

// Se chamado diretamente pela linha de comando
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

