// Demandas do Frank em <FRANK_PASTA_DE_DADOS>/demandas/<id>.json. Só no servidor local.
import { ErroHttp } from './http.js';
import { MOTIVO_SO_LOCAL } from './hermes.js';
import { TIME } from './frank.js';

// Primeira fala do histórico quando o painel não manda a saudação que o Frank falou ao acordar.
export const saudacaoSemente = (nome) => (nome ? `Fala, ${nome}! O time tá a postos, é só pedir.` : 'Fala! O time tá a postos, é só pedir.');
export const TITULO_PROVISORIO = 'Nova demanda';
const ID_DA_DEMANDA = /^d-[a-z0-9-]{6,60}$/;
const PALAVRAS_DO_TITULO = 6;
const LIMITE_DO_TITULO = 60;

// Especificador numa variável: só o server.mjs tem disco, e fora dele a rota já devolveu 503 antes de chegar aqui.
const MODULO_DE_DISCO = 'node:fs/promises';
let discoCarregado;

async function disco() {
  discoCarregado ??= import(MODULO_DE_DISCO).catch(() => null);
  const fs = await discoCarregado;
  if (!fs) throw new ErroHttp(503, MOTIVO_SO_LOCAL);
  return fs;
}

const pastaDasDemandas = (env) => `${env.FRANK_PASTA_DE_DADOS}/demandas`;

function arquivoDaDemanda(env, id) {
  if (typeof id !== 'string' || !ID_DA_DEMANDA.test(id)) throw new ErroHttp(404, 'Demanda não encontrada.');
  return `${pastaDasDemandas(env)}/${id}.json`;
}

export function novoIdDeDemanda(agora = new Date()) {
  const carimbo = agora.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15).toLowerCase();
  return `d-${carimbo}-${crypto.randomUUID().slice(0, 6)}`;
}

// Título não termina em conjunção, preposição, artigo ou contração: "Pede pra Renata 3 headlines e" vira
// "Pede pra Renata 3 headlines".
const PALAVRAS_DE_LIGACAO = new Set(
  ('e ou mas nem que se como a o as os um uma uns umas à às ao aos de da do das dos em na no nas nos num numa ' +
    'pra pro pras pros para por pela pelo pelas pelos com sem sobre entre até após').split(' '),
);
const semPontuacaoFinal = (texto) => texto.replace(/[\s,.;:!?…]+$/u, '');

export function tituloDoPedido(texto) {
  const semVocativo = texto.replace(/^\s*(?:(?:oi|olá|ola|e aí|e ai|fala),?\s+)?frank[\s,.:!?]+/i, '');
  const palavras = [];
  for (const palavra of semVocativo.trim().split(/\s+/).filter(Boolean)) {
    if (palavras.length === PALAVRAS_DO_TITULO) break;
    if (palavras.length > 0 && [...palavras, palavra].join(' ').length > LIMITE_DO_TITULO) break;
    palavras.push(palavras.length === 0 ? palavra.slice(0, LIMITE_DO_TITULO) : palavra);
  }
  while (palavras.length > 1 && PALAVRAS_DE_LIGACAO.has(semPontuacaoFinal(palavras.at(-1)).toLowerCase())) palavras.pop();
  const titulo = semPontuacaoFinal(palavras.join(' ')).trim();
  return titulo ? titulo.charAt(0).toUpperCase() + titulo.slice(1) : TITULO_PROVISORIO;
}

export function novaDemanda({ titulo, saudacao, cerebro = null, nome = '', agora = new Date() } = {}) {
  const momento = agora.toISOString();
  return {
    id: novoIdDeDemanda(agora),
    nome: nome || '',
    titulo: titulo || null,
    criadaEm: momento,
    atualizadaEm: momento,
    cerebro,
    historico: [{ role: 'assistant', content: saudacao || saudacaoSemente(nome) }],
    entregas: [],
    runs: [],
  };
}

export async function lerDemanda(env, id) {
  const fs = await disco();
  try {
    return JSON.parse(await fs.readFile(arquivoDaDemanda(env, id), 'utf8'));
  } catch (erro) {
    if (erro?.code === 'ENOENT') throw new ErroHttp(404, 'Demanda não encontrada.', undefined, { cause: erro });
    throw erro;
  }
}

export async function gravarDemanda(env, demanda) {
  const fs = await disco();
  const arquivo = arquivoDaDemanda(env, demanda.id);
  await fs.mkdir(pastaDasDemandas(env), { recursive: true });
  const temporario = `${arquivo}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(temporario, `${JSON.stringify(demanda, null, 2)}\n`);
  await fs.rename(temporario, arquivo);
  return demanda;
}

// Fila por demanda: dois pedidos à mesma demanda (o turno e o relay do stream) nunca intercalam leitura e escrita.
const filas = new Map();

export function alterarDemanda(env, id, alterar) {
  const anterior = filas.get(id) ?? Promise.resolve();
  const atual = anterior.then(async () => {
    const demanda = await lerDemanda(env, id);
    const resultado = await alterar(demanda);
    await gravarDemanda(env, demanda);
    return resultado;
  });
  const cauda = atual.catch(() => {});
  filas.set(id, cauda);
  cauda.then(() => {
    if (filas.get(id) === cauda) filas.delete(id);
  });
  return atual;
}

async function lerTodas(env) {
  const fs = await disco();
  let nomes;
  try {
    nomes = await fs.readdir(pastaDasDemandas(env));
  } catch (erro) {
    if (erro?.code === 'ENOENT') return [];
    throw erro;
  }
  const demandas = [];
  for (const nome of nomes.filter((item) => item.endsWith('.json'))) {
    try {
      demandas.push(JSON.parse(await fs.readFile(`${pastaDasDemandas(env)}/${nome}`, 'utf8')));
    } catch {
      // Arquivo truncado ou de fora do formato: fica fora da lista em vez de derrubar a rota.
    }
  }
  return demandas;
}

export const resumoDaDemanda = (demanda) => ({
  id: demanda.id,
  titulo: demanda.titulo ?? TITULO_PROVISORIO,
  atualizadaEm: demanda.atualizadaEm,
  pendentes: demanda.entregas.filter((entrega) => entrega.status === 'pendente').length,
});

export async function listarDemandas(env) {
  const demandas = await lerTodas(env);
  return demandas.map(resumoDaDemanda).sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm));
}

export async function listarRunsAtivos(env) {
  const demandas = await lerTodas(env);
  return demandas.flatMap((demanda) => demanda.runs.filter((run) => run.status === 'rodando')
    .map((run) => ({ demandaId: demanda.id, runId: run.runId })));
}

export async function acharDemandaDoRun(env, runId) {
  const demandas = await lerTodas(env);
  return demandas.find((demanda) => demanda.runs.some((run) => run.runId === runId)) ?? null;
}

const semPontoFinal = (texto) => texto.trim().replace(/\.+$/, '').trim();
const APROVACAO = /^Aprovo a entrega d[ao] (\p{L}+): (.+)$/su;
const AJUSTE = /^Ajuste na entrega d[ao] (\p{L}+) \((.+)\): (.+)$/su;
const DESCARTE = /^Descarto a entrega d[ao] (\p{L}+): (.+)$/su;

function idPeloNome(nome) {
  const normalizado = nome.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return TIME.find((assistente) => assistente.id === normalizado)?.id ?? null;
}

// "Aprovo a entrega da Renata: <título>.", "Ajuste na entrega da Renata (<título>): <observação>." e
// "Descarto a entrega da Renata: <título>." (contrato da ponte).
export function marcarDecisao(demanda, texto, agora = new Date()) {
  const aprovacao = APROVACAO.exec(texto.trim());
  const ajuste = aprovacao ? null : AJUSTE.exec(texto.trim());
  const descarte = aprovacao || ajuste ? null : DESCARTE.exec(texto.trim());
  const casamento = aprovacao ?? ajuste ?? descarte;
  if (!casamento) return null;
  const agente = idPeloNome(casamento[1]);
  const titulo = semPontoFinal(casamento[2]);
  const abertas = demanda.entregas.filter((entrega) => entrega.agente === agente && entrega.status === 'pendente');
  const entrega = abertas.find((item) => semPontoFinal(item.titulo) === titulo) ?? abertas.at(-1);
  if (!entrega) return null;
  entrega.status = aprovacao ? 'aprovada' : ajuste ? 'ajuste' : 'descartada';
  entrega.decididaEm = agora.toISOString();
  if (ajuste) entrega.observacao = ajuste[3].trim();
  return { tipo: aprovacao ? 'aprovacao' : ajuste ? 'ajuste' : 'descarte', entrega };
}
