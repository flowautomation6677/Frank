// Servidor do painel de voz do Frank: serve public/ e executa as rotas de functions/, na convenção de pastas do
// Cloudflare Pages. Uso: node server.mjs. As variáveis vêm do ambiente ou do .env desta pasta (FRANK_ENV_FILE aponta
// outro arquivo), e a do ambiente vence. Escuta em FRANK_HOST (padrão 127.0.0.1) e FRANK_PORTA (padrão 8787).
// Demandas do Frank em FRANK_PASTA_DE_DADOS (padrão data/, nesta pasta). Atrás de proxy HTTPS, FRANK_ORIGEM_PUBLICA
// (https://frank.exemplo.com) libera esse host; as funções veem a origem pública, que é a do navegador.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { ErroHttp, responderErro, responderJson } from './functions/_lib/http.js';
import { retomarAcompanhamentos } from './functions/_lib/acompanhamento.js';
import { empresaDoDono, nomeDoDono } from './functions/_lib/frank.js';
import { vozDoEnv, vozPadraoDoGemini } from './functions/_lib/gemini.js';
import { binarioDoHermes, sondarQuadro } from './functions/_lib/quadro.js';
import { obterCofre } from './functions/_lib/cofre.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PASTA_PUBLICA = path.join(RAIZ, 'public');
const PASTA_DAS_FUNCOES = path.join(RAIZ, 'functions');
const HOST_PADRAO = '127.0.0.1';
const PORTA_PADRAO = 8787;
const VARIAVEIS_REPASSADAS = [
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'FRANK_ACCESS_CODE',
  'HERMES_API_URL',
  'HERMES_API_KEY',
  'FRANK_ORIGEM_PUBLICA',
  'FRANK_PORTA_TUNEL_VARIAVEL',
  'FRANK_NOME_DO_DONO',
  'FRANK_NOME_DA_EMPRESA',
  'FRANK_VOZ',
  'HERMES_BIN',
  'HERMES_HOME',
];
const LIMITE_DO_CORPO = 256 * 1024;
const SEGMENTO_DE_ROTA = /^[A-Za-z0-9_-]{1,100}$/;
const PARAMETRO_DE_ROTA = /^\[([A-Za-z][A-Za-z0-9]*)\](\.js)?$/;
const SUFIXO_DO_METODO = { GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete', HEAD: 'Head', OPTIONS: 'Options' };

const TIPOS_DE_CONTEUDO = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// Variável definida no processo vence o arquivo, mesmo vazia: é assim que os testes rodam sem as chaves reais.
// Devolve uma função que lê cada variável já com essa ordem.
async function carregarAmbiente(arquivo) {
  let doArquivo = {};
  try {
    doArquivo = parseEnv(await readFile(arquivo, 'utf8'));
  } catch (erro) {
    if (erro.code !== 'ENOENT') throw erro;
  }
  return (nome) => process.env[nome] ?? doArquivo[nome];
}

function lerPorta(texto) {
  if (texto === undefined || String(texto).trim() === '') return PORTA_PADRAO;
  const porta = Number(texto);
  if (!Number.isInteger(porta) || porta < 0 || porta > 65_535) {
    console.error(`[frank] FRANK_PORTA precisa ser um número inteiro de 0 a 65535, e veio "${texto}".`);
    process.exit(1);
  }
  return porta;
}

async function statSeExistir(caminho) {
  try {
    return await stat(caminho);
  } catch (erro) {
    if (erro.code === 'ENOENT' || erro.code === 'ENOTDIR') return null;
    throw erro;
  }
}

function resolverArquivoPublico(caminhoDaUrl) {
  let decodificado;
  try {
    decodificado = decodeURIComponent(caminhoDaUrl);
  } catch {
    return null;
  }
  const segmentos = decodificado.split('/').filter(Boolean);
  if (segmentos.some((segmento) => segmento.startsWith('.') || segmento.includes('\\') || segmento.includes('\0'))) return null;
  const arquivo = path.join(PASTA_PUBLICA, ...segmentos);
  return arquivo === PASTA_PUBLICA || arquivo.startsWith(PASTA_PUBLICA + path.sep) ? arquivo : null;
}

function responderTexto(res, status, texto, cabecalhos = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...cabecalhos });
  res.end(texto);
}

async function servirArquivo(req, res, caminhoDaUrl) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return responderTexto(res, 405, 'Método não permitido.', { allow: 'GET, HEAD' });
  let arquivo = resolverArquivoPublico(caminhoDaUrl);
  let info = arquivo && (await statSeExistir(arquivo));
  if (info?.isDirectory()) {
    arquivo = path.join(arquivo, 'index.html');
    info = await statSeExistir(arquivo);
  }
  if (!info?.isFile()) return responderTexto(res, 404, 'Arquivo não encontrado.');

  res.writeHead(200, {
    'content-type': TIPOS_DE_CONTEUDO[path.extname(arquivo).toLowerCase()] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  await pipeline(createReadStream(arquivo), res);
}

async function lerCorpo(req) {
  const partes = [];
  let tamanho = 0;
  for await (const parte of req) {
    tamanho += parte.length;
    if (tamanho > LIMITE_DO_CORPO) throw new ErroHttp(413, `O corpo da requisição passou de ${LIMITE_DO_CORPO / 1024} KB.`);
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

function cabecalhosWeb(cabecalhosBrutos) {
  const cabecalhos = new Headers();
  for (let indice = 0; indice < cabecalhosBrutos.length; indice += 2) {
    cabecalhos.append(cabecalhosBrutos[indice], cabecalhosBrutos[indice + 1]);
  }
  return cabecalhos;
}

async function importarSeExistir(arquivo) {
  const info = await statSeExistir(arquivo);
  return info?.isFile() ? import(pathToFileURL(arquivo).href) : null;
}

function manipuladorDaRota(rota, metodo) {
  const manipulador = rota[`onRequest${SUFIXO_DO_METODO[metodo] ?? ''}`] ?? rota.onRequest;
  return manipulador ?? (() => responderJson(405, { erro: `Método ${metodo} não permitido nesta rota.` }));
}

// Nome literal vence o dinâmico: em functions/api/frank/turno/, "turno.js" atende
// /api/frank/turno e "[runId]/" atende /api/frank/turno/<id>/...
async function acharEntrada(pasta, segmento, { arquivo }) {
  const literal = path.join(pasta, arquivo ? `${segmento}.js` : segmento);
  // Arquivo com "_" no começo (como _middleware.js) nunca é rota.
  const info = segmento.startsWith('_') ? null : await statSeExistir(literal);
  if (arquivo ? info?.isFile() : info?.isDirectory()) return { caminho: literal };
  let nomes;
  try {
    nomes = await readdir(pasta, { withFileTypes: true });
  } catch (erro) {
    if (erro.code === 'ENOENT' || erro.code === 'ENOTDIR') return null;
    throw erro;
  }
  for (const entrada of nomes) {
    const parametro = PARAMETRO_DE_ROTA.exec(entrada.name);
    if (!parametro || Boolean(parametro[2]) !== arquivo || (arquivo ? !entrada.isFile() : !entrada.isDirectory())) continue;
    return { caminho: path.join(pasta, entrada.name), parametro: parametro[1] };
  }
  return null;
}

// Convenção de pastas do Pages: functions/api/live/session.js atende /api/live/session, e cada
// _middleware.js no caminho roda antes da rota, seguindo adiante com context.next().
async function montarEtapas(segmentos, metodo) {
  const naoEncontrada = () => responderJson(404, { erro: 'Rota da API não encontrada.' });
  if (segmentos.length === 0 || !segmentos.every((segmento) => SEGMENTO_DE_ROTA.test(segmento))) return { etapas: [naoEncontrada], params: {} };
  const etapas = [];
  const params = {};
  let pasta = PASTA_DAS_FUNCOES;
  for (const [indice, segmento] of segmentos.entries()) {
    const middleware = await importarSeExistir(path.join(pasta, '_middleware.js'));
    if (middleware?.onRequest) etapas.push(middleware.onRequest);
    const entrada = await acharEntrada(pasta, segmento, { arquivo: indice === segmentos.length - 1 });
    if (!entrada) return { etapas: [...etapas, naoEncontrada], params };
    if (entrada.parametro) params[entrada.parametro] = segmento;
    pasta = entrada.caminho;
  }
  const rota = await importarSeExistir(pasta);
  etapas.push(rota ? manipuladorDaRota(rota, metodo) : naoEncontrada);
  return { etapas, params };
}

async function executarFuncao(req, url, env) {
  const corpo = req.method === 'GET' || req.method === 'HEAD' ? undefined : await lerCorpo(req);
  const request = new Request(url, { method: req.method, headers: cabecalhosWeb(req.rawHeaders), body: corpo });
  const { etapas, params } = await montarEtapas(url.pathname.split('/').filter(Boolean), req.method);
  const contexto = { request, env, params, data: {}, waitUntil: () => {} };
  const executarEtapa = (indice) => etapas[indice]({ ...contexto, next: () => executarEtapa(indice + 1) });
  return executarEtapa(0);
}

async function enviarResposta(res, resposta, metodo) {
  res.writeHead(resposta.status, Object.fromEntries(resposta.headers));
  if (!resposta.body || metodo === 'HEAD') return res.end();
  await pipeline(Readable.fromWeb(resposta.body), res);
}

function criarServidor(env) {
  const publica = env.FRANK_ORIGEM_PUBLICA ? new URL(env.FRANK_ORIGEM_PUBLICA) : null;
  return http.createServer(async (req, res) => {
    try {
      const portaLocal = req.socket.localPort;
      const hosts = [`127.0.0.1:${portaLocal}`, `localhost:${portaLocal}`];
      if (portaLocal === 80) hosts.push('127.0.0.1', 'localhost');
      const host = req.headers.host?.toLowerCase();
      const viaProxy = publica !== null && host === publica.host;
      // SSH pode usar outra porta no computador. Libera apenas hosts de loopback
      // literais; o middleware continua exigindo mesma origem para toda chamada.
      const portaTunel = /^(?:127\.0\.0\.1|localhost):(\d{1,5})$/.exec(host || '');
      const viaTunel = env.FRANK_PORTA_TUNEL_VARIAVEL === '1' && portaTunel
        && Number(portaTunel[1]) > 0 && Number(portaTunel[1]) <= 65535;
      if ((!hosts.includes(host) && !viaProxy && !viaTunel) || !req.url.startsWith('/') || req.url.startsWith('//')) {
        throw new ErroHttp(403, 'Host não autorizado. Abra o Frank pelo endereço local.');
      }
      const base = viaProxy ? publica.origin : `http://${host}`;
      const url = new URL(req.url, base);
      if (url.origin !== new URL(base).origin) throw new ErroHttp(403, 'Destino não autorizado.');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await enviarResposta(res, await executarFuncao(req, url, env), req.method);
      } else {
        await servirArquivo(req, res, url.pathname);
      }
    } catch (erro) {
      if (erro.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
      if (!(erro instanceof ErroHttp)) console.error(`[frank] falha em ${req.method} ${req.url}:`, erro);
      if (res.headersSent) return res.destroy();
      const resposta = erro instanceof ErroHttp ? responderErro(erro) : responderJson(500, { erro: 'Erro interno no servidor do Frank.' });
      await enviarResposta(res, resposta, req.method);
    }
  });
}

const arquivoEnv = process.env.FRANK_ENV_FILE ? path.resolve(process.env.FRANK_ENV_FILE) : path.join(RAIZ, '.env');
const variavel = await carregarAmbiente(arquivoEnv);
const env = {};
for (const nome of VARIAVEIS_REPASSADAS) {
  const valor = variavel(nome);
  if (valor !== undefined) env[nome] = valor;
}
// Só o servidor define a pasta de dados: é ela que libera as rotas /api/frank/*. Caminho relativo parte desta pasta.
const pastaDeDados = variavel('FRANK_PASTA_DE_DADOS');
env.FRANK_PASTA_DE_DADOS = pastaDeDados ? path.resolve(RAIZ, pastaDeDados) : path.join(RAIZ, 'data');
// Injeta com segurança segredos do cofre criptografado em memória em tempo de execução
obterCofre({ env }).injetarNoAmbiente(env);
const host = variavel('FRANK_HOST') || HOST_PADRAO;
const porta = lerPorta(variavel('FRANK_PORTA'));
const servidor = criarServidor(env);
await new Promise((resolve, reject) => {
  servidor.once('error', reject);
  servidor.listen(porta, host, resolve);
});

console.log(`Painel do Frank no ar em http://${host}:${servidor.address().port}`);
retomarAcompanhamentos(env).then(({ retomados, falhas }) => {
  if (retomados || falhas) console.log(`[frank] recuperação: ${retomados} turnos retomados; ${falhas} falhas.`);
}).catch(() => console.warn('[frank] recuperação indisponível; reabra a demanda para reconectar.'));
console.log(
  `Gemini Live: ${env.GEMINI_API_KEY ? 'chave encontrada' : 'sem GEMINI_API_KEY'} · ` +
    `GPT Live: ${env.OPENAI_API_KEY ? 'chave encontrada' : 'desligado (sem OPENAI_API_KEY)'} · ` +
    `Hermes: ${env.HERMES_API_URL && env.HERMES_API_KEY ? 'configurado' : 'sem HERMES_API_URL e HERMES_API_KEY'} · ` +
    `código de acesso: ${env.FRANK_ACCESS_CODE ? 'exigido' : 'desligado'} · ` +
    `dono: ${nomeDoDono(env) || 'sem nome'}${empresaDoDono(env) ? ` (${empresaDoDono(env)})` : ''} · ` +
    `voz do Gemini: ${vozPadraoDoGemini(env)} · ` +
    `quadro do Kanban: ${binarioDoHermes(env)}`,
);
// Uma leitura na partida: sem a CLI ou sem o quadro, o log avisa já (uma vez) e o painel segue sem ele.
sondarQuadro(env).then((leitura) => {
  if (leitura.disponivel) console.log(`[frank] quadro do Kanban lido: ${leitura.tarefas.length} tarefas.`);
}).catch(() => {});
if (env.FRANK_VOZ?.trim() && !vozDoEnv(env)) {
  console.warn(`[frank] FRANK_VOZ="${env.FRANK_VOZ}" não está na lista do Gemini Live; vale a voz ${vozPadraoDoGemini(env)}.`);
}

function encerrar() {
  servidor.close(() => process.exit(0));
  servidor.closeIdleConnections();
  setTimeout(() => process.exit(1), 5000).unref();
}
process.once('SIGINT', encerrar);
process.once('SIGTERM', encerrar);
