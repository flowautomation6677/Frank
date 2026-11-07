// Quadro Kanban do Hermes: o Frank distribui o trabalho em tarefas com assignee igual ao id do assistente.
// O painel lê o quadro pela CLI (`hermes kanban list --json`), estável entre versões do Hermes, e só quando um
// navegador pergunta (GET /api/frank/quadro, a cada 5 s com a aba visível). Cada chamada da CLI custa cerca de
// 0,6 s de CPU: ela roda de novo só quando o kanban.db mudou (data e tamanho), no máximo a cada 5 s, e uma vez por
// minuto mesmo sem mudança. Entrega recente pede um `kanban show`, uma vez por entrega: o worker conclui pela ferramenta
// kanban_complete, e aí o `result` da lista vem vazio e o texto fica no latest_summary do show.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IDS_DO_TIME } from './frank.js';

export const INTERVALO_MINIMO_MS = 5_000;
export const VALIDADE_SEM_MUDANCA_MS = 60_000;
export const ESPERA_DEPOIS_DE_FALHA_MS = 60_000;
// Entrega mais velha que isso não entra: ao ligar, o painel não despeja o histórico do quadro.
export const JANELA_DAS_ENTREGAS_MS = 12 * 60 * 60_000;
const PRAZO_DA_CLI_MS = 15_000;
const LIMITE_DA_SAIDA = 8 * 1024 * 1024;
const LIMITE_DE_ENTREGAS = 20;
// Cada show custa o mesmo que a lista: no máximo 4 por leitura; o resto fica para a leitura seguinte, 5 s depois.
const LIMITE_DE_DETALHES_POR_LEITURA = 4;
const LIMITE_DO_TEXTO = 4000;
const LIMITE_DO_TITULO = 200;
const DIAS_DAS_DECISOES_MS = 30 * 24 * 60 * 60_000;
const ESTADOS_NA_FILA = new Set(['ready', 'todo', 'scheduled']);
const ARQUIVO_DAS_DECISOES = 'quadro-decisoes.json';
export const MOTIVO_SO_LOCAL = 'O quadro do Kanban só é lido no servidor local.';

// "Aprovo a entrega da Renata no quadro (tarefa t_5b5a7084): …", e o mesmo para "Descarto" e "Ajuste na entrega".
// O "no quadro" logo depois do nome deixa o texto fora do formato das entregas da demanda (marcarDecisao).
const DECISAO_DO_QUADRO = /^(?:Aprovo a entrega|Descarto a entrega|Ajuste na entrega) d[ao] \p{L}+ no quadro \(tarefa (t_[A-Za-z0-9_-]{1,64})[,)]/u;

const texto = (valor) => (typeof valor === 'string' ? valor : '');
const espacosSimples = (valor) => texto(valor).replace(/\s+/g, ' ').trim();
const emMs = (segundos) => (typeof segundos === 'number' && Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : null);

function idDoAssistente(assignee) {
  const id = espacosSimples(assignee).toLowerCase();
  return IDS_DO_TIME.includes(id) ? id : null;
}

function cortar(valor, limite) {
  const limpo = texto(valor).trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1).trimEnd()}…` : limpo;
}

// Pedido de revisão mais recente do `kanban show`: o resumo e o momento em que a tarefa entrou em review.
function revisaoDoDetalhe(detalhe) {
  const eventos = Array.isArray(detalhe?.events) ? detalhe.events : [];
  const pedido = eventos.findLast((evento) => evento?.kind === 'review_requested');
  const momento = emMs(pedido?.created_at);
  if (!momento) return null;
  return { momento, resumo: texto(pedido?.payload?.summary).trim() || texto(detalhe?.latest_summary).trim() };
}

function entregaDaTarefa(tarefa, agente, detalhe) {
  let momento;
  let corpo;
  if (tarefa.status === 'done') {
    momento = emMs(tarefa.completed_at);
    corpo = texto(tarefa.result).trim() || texto(detalhe?.latest_summary).trim();
  } else {
    const revisao = revisaoDoDetalhe(detalhe);
    momento = revisao?.momento ?? null;
    corpo = revisao?.resumo ?? '';
  }
  if (!momento) return null;
  const segundos = Math.round(momento / 1000);
  return {
    chave: `kanban:${tarefa.id}:${segundos}`,
    tarefaId: tarefa.id,
    agente,
    titulo: cortar(espacosSimples(tarefa.title), LIMITE_DO_TITULO) || 'Tarefa sem título',
    texto: cortar(corpo, LIMITE_DO_TEXTO) || (tarefa.status === 'done' ? 'Tarefa concluída no quadro, sem resumo.' : 'Tarefa em revisão no quadro, sem resumo.'),
    situacao: tarefa.status === 'done' ? 'concluida' : 'revisao',
    momento,
    criadaEm: new Date(momento).toISOString(),
  };
}

// tarefas: saída de `hermes kanban list --json`. detalhes: id → saída de `hermes kanban show <id> --json` das entregas
// recentes (review, ou done sem result). decisoes: id → ISO do que o dono já decidiu no painel. Devolve, por assistente, o que o cartão mostra
// (trabalhando > travado > na fila) e as entregas recentes (review ou done) ainda sem decisão.
export function resumirQuadro(tarefas, { detalhes = new Map(), decisoes = {}, agora = Date.now() } = {}) {
  const porAgente = new Map();
  const entregas = [];
  const desde = agora - JANELA_DAS_ENTREGAS_MS;
  for (const tarefa of Array.isArray(tarefas) ? tarefas : []) {
    if (!tarefa || typeof tarefa !== 'object' || typeof tarefa.id !== 'string') continue;
    const agente = idDoAssistente(tarefa.assignee);
    if (!agente) continue;
    const titulo = cortar(espacosSimples(tarefa.title), LIMITE_DO_TITULO) || 'Tarefa sem título';
    const grupos = porAgente.get(agente) ?? { rodando: [], travadas: [], fila: [] };
    porAgente.set(agente, grupos);
    if (tarefa.status === 'running') grupos.rodando.push({ titulo, desde: emMs(tarefa.started_at) ?? 0 });
    else if (tarefa.status === 'blocked') grupos.travadas.push({ titulo });
    else if (ESTADOS_NA_FILA.has(tarefa.status)) grupos.fila.push({ titulo, criadaEm: emMs(tarefa.created_at) ?? 0 });
    else if (tarefa.status === 'done' || tarefa.status === 'review') {
      const entrega = entregaDaTarefa(tarefa, agente, detalhes.get(tarefa.id));
      if (!entrega || entrega.momento < desde) continue;
      const decidida = Date.parse(texto(decisoes[tarefa.id]));
      if (Number.isFinite(decidida) && decidida >= entrega.momento) continue;
      entregas.push(entrega);
    }
  }

  const agentes = {};
  for (const [agente, { rodando, travadas, fila }] of porAgente) {
    fila.sort((a, b) => a.criadaEm - b.criadaEm);
    if (rodando.length > 0) {
      rodando.sort((a, b) => b.desde - a.desde);
      agentes[agente] = { status: 'trabalhando', tarefa: rodando[0].titulo, paralelas: rodando.length - 1, naFila: fila.length };
    } else if (travadas.length > 0) {
      agentes[agente] = { status: 'travado', tarefa: travadas[0].titulo, paralelas: 0, naFila: fila.length };
    } else if (fila.length > 0) {
      agentes[agente] = { status: 'fila', tarefa: fila[0].titulo, paralelas: 0, naFila: fila.length - 1 };
    }
  }
  entregas.sort((a, b) => a.momento - b.momento);
  return { agentes, entregas: entregas.slice(-LIMITE_DE_ENTREGAS) };
}

export function binarioDoHermes(env) {
  const escolhido = espacosSimples(env?.HERMES_BIN);
  if (escolhido) return escolhido;
  // O instalador põe a CLI em ~/.local/bin, que a unidade do systemd não tem no PATH.
  const local = path.join(os.homedir(), '.local', 'bin', 'hermes');
  return existsSync(local) ? local : 'hermes';
}

function pastaDoHermes(env) {
  return espacosSimples(env?.HERMES_HOME) || process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
}

function executarCli(env, argumentos) {
  const ambiente = { ...process.env, ...(espacosSimples(env?.HERMES_HOME) ? { HERMES_HOME: espacosSimples(env.HERMES_HOME) } : {}) };
  return new Promise((resolver, rejeitar) => {
    execFile(binarioDoHermes(env), argumentos, { cwd: os.homedir(), env: ambiente, timeout: PRAZO_DA_CLI_MS, maxBuffer: LIMITE_DA_SAIDA, windowsHide: true, shell: process.platform === 'win32' }, (erro, saida, saidaDeErro) => {
      if (erro) {
        erro.saidaDeErro = texto(saidaDeErro);
        rejeitar(erro);
      } else resolver(saida);
    });
  });
}

// Data e tamanho do kanban.db (e do -wal, se o SQLite estiver em WAL): mudou, o quadro mudou. null sem o arquivo.
export async function marcaDoQuadro(env) {
  const base = path.join(pastaDoHermes(env), 'kanban.db');
  const partes = [];
  for (const arquivo of [base, `${base}-wal`]) {
    try {
      const info = await stat(arquivo);
      partes.push(`${info.mtimeMs}:${info.size}`);
    } catch (erro) {
      if (erro?.code !== 'ENOENT') throw erro;
      partes.push('-');
    }
  }
  return partes[0] === '-' ? null : partes.join('|');
}

function motivoDaFalha(erro, env) {
  if (erro?.code === 'ENOENT') return `não achei a CLI do Hermes em "${binarioDoHermes(env)}"; defina HERMES_BIN no .env`;
  if (erro?.killed) return `a CLI do Hermes passou de ${PRAZO_DA_CLI_MS / 1000} s`;
  if (erro instanceof SyntaxError || erro?.foraDoFormato) return 'a CLI do Hermes devolveu o quadro fora do formato';
  const detalhe = espacosSimples(erro?.saidaDeErro).slice(0, 160) || espacosSimples(erro?.message).slice(0, 160);
  return `a CLI do Hermes falhou${detalhe ? `: ${detalhe}` : ''}`;
}

// Entrega recente do time que ainda não tem o texto na lista: review sempre; done sem `result`, dentro da janela.
function precisaDoDetalhe(tarefa, agora) {
  if (!idDoAssistente(tarefa.assignee)) return false;
  if (tarefa.status === 'review') return true;
  if (tarefa.status !== 'done' || texto(tarefa.result).trim()) return false;
  const momento = emMs(tarefa.completed_at);
  return Boolean(momento) && momento >= agora - JANELA_DAS_ENTREGAS_MS;
}

// Muda quando a tarefa entrega de novo (outra revisão, outra conclusão): aí o show é lido outra vez.
const chaveDoDetalhe = (tarefa) => `${tarefa.status}:${tarefa.completed_at ?? ''}:${tarefa.started_at ?? ''}`;

// executar(env, argumentos) → saída da CLI; lerMarca(env) → marca do kanban.db. Os testes trocam os dois e o relógio.
export function criarLeitorDoQuadro({ executar = executarCli, lerMarca = marcaDoQuadro, relogio = Date.now, avisar = console.warn, informar = console.log } = {}) {
  let tarefas = null;
  let lidoEm = 0;
  let marca = null;
  let indisponivelAte = 0;
  let motivo = null;
  let avisou = false;
  let leitura = null;
  let faltamDetalhes = false;
  // id → { chave, dados }: o `kanban show` da entrega; dados null quando o show falhou.
  const detalhesLidos = new Map();

  function resultado() {
    return { disponivel: true, motivo: null, tarefas, detalhes: new Map([...detalhesLidos].map(([id, item]) => [id, item.dados])) };
  }

  async function atualizar(env, marcaAtual) {
    try {
      const lista = JSON.parse(await executar(env, ['kanban', 'list', '--json']));
      if (!Array.isArray(lista)) throw Object.assign(new Error('quadro fora do formato'), { foraDoFormato: true });
      const agora = relogio();
      const vistas = new Set();
      let lidos = 0;
      faltamDetalhes = false;
      for (const tarefa of lista) {
        if (typeof tarefa?.id !== 'string') continue;
        vistas.add(tarefa.id);
        if (!precisaDoDetalhe(tarefa, agora)) continue;
        const chave = chaveDoDetalhe(tarefa);
        if (detalhesLidos.get(tarefa.id)?.chave === chave) continue;
        if (lidos >= LIMITE_DE_DETALHES_POR_LEITURA) {
          faltamDetalhes = true;
          continue;
        }
        lidos += 1;
        let dados = null;
        try {
          dados = JSON.parse(await executar(env, ['kanban', 'show', tarefa.id, '--json']));
        } catch {
          // Sem o detalhe, a entrega em review espera; a concluída aparece com o texto padrão.
        }
        detalhesLidos.set(tarefa.id, { chave, dados });
      }
      for (const id of detalhesLidos.keys()) if (!vistas.has(id)) detalhesLidos.delete(id);
      tarefas = lista;
      lidoEm = relogio();
      marca = marcaAtual;
      if (avisou) informar('[frank] quadro do Kanban lido de novo.');
      avisou = false;
      motivo = null;
      return resultado();
    } catch (erro) {
      motivo = motivoDaFalha(erro, env);
      tarefas = null;
      indisponivelAte = relogio() + ESPERA_DEPOIS_DE_FALHA_MS;
      if (!avisou) avisar(`[frank] quadro do Kanban indisponível (${motivo}); o painel segue sem ele.`);
      avisou = true;
      return { disponivel: false, motivo, tarefas: [], detalhes: new Map() };
    }
  }

  return {
    async ler(env) {
      const agora = relogio();
      if (agora < indisponivelAte) return { disponivel: false, motivo, tarefas: [], detalhes: new Map() };
      let marcaAtual = null;
      try {
        marcaAtual = await lerMarca(env);
      } catch {
        // Sem a marca, vale só o intervalo mínimo.
      }
      if (tarefas && agora - lidoEm < INTERVALO_MINIMO_MS) return resultado();
      if (tarefas && marcaAtual && marcaAtual === marca && !faltamDetalhes && agora - lidoEm < VALIDADE_SEM_MUDANCA_MS) return resultado();
      leitura ??= atualizar(env, marcaAtual).finally(() => {
        leitura = null;
      });
      return leitura;
    },
  };
}

const leitorPadrao = criarLeitorDoQuadro();

function arquivoDasDecisoes(env) {
  return path.join(env.FRANK_PASTA_DE_DADOS, ARQUIVO_DAS_DECISOES);
}

export async function lerDecisoesDoQuadro(env) {
  try {
    const dados = JSON.parse(await readFile(arquivoDasDecisoes(env), 'utf8'));
    return dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
  } catch (erro) {
    if (erro?.code === 'ENOENT' || erro instanceof SyntaxError) return {};
    throw erro;
  }
}

let filaDasDecisoes = Promise.resolve();

// O turno de decisão foi aceito pelo Hermes: a entrega do quadro sai da bandeja e só volta se a tarefa entregar de novo.
export function anotarDecisaoDoQuadro(env, pedido, agora = new Date()) {
  const tarefaId = DECISAO_DO_QUADRO.exec(texto(pedido).trim())?.[1];
  if (!tarefaId || !env?.FRANK_PASTA_DE_DADOS) return Promise.resolve(null);
  const gravar = async () => {
    const decisoes = await lerDecisoesDoQuadro(env);
    decisoes[tarefaId] = agora.toISOString();
    for (const [id, quando] of Object.entries(decisoes)) {
      if (!(agora.getTime() - Date.parse(quando) < DIAS_DAS_DECISOES_MS)) delete decisoes[id];
    }
    await mkdir(env.FRANK_PASTA_DE_DADOS, { recursive: true });
    const arquivo = arquivoDasDecisoes(env);
    const temporario = `${arquivo}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporario, `${JSON.stringify(decisoes, null, 2)}\n`);
    await rename(temporario, arquivo);
    return tarefaId;
  };
  const vez = filaDasDecisoes.then(gravar, gravar);
  filaDasDecisoes = vez.catch(() => {});
  return vez;
}

// O que GET /api/frank/quadro devolve ao painel.
export async function quadroParaOPainel(env, { leitor = leitorPadrao, agora = Date.now() } = {}) {
  if (!env?.FRANK_PASTA_DE_DADOS) return { disponivel: false, motivo: MOTIVO_SO_LOCAL, agentes: {}, entregas: [] };
  const leitura = await leitor.ler(env);
  if (!leitura.disponivel) return { disponivel: false, motivo: leitura.motivo, agentes: {}, entregas: [] };
  const resumo = resumirQuadro(leitura.tarefas, { detalhes: leitura.detalhes, decisoes: await lerDecisoesDoQuadro(env), agora });
  return { disponivel: true, motivo: null, ...resumo };
}

// Leitura na partida do servidor: o log avisa já se a CLI ou o quadro faltarem.
export function sondarQuadro(env, { leitor = leitorPadrao } = {}) {
  return leitor.ler(env);
}
