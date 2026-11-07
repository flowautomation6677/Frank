// Um coletor por run no processo local; a coleta pertence ao servidor, não à conexão do painel.
import { abrirEventos } from './ponte.js';
import { listarRunsAtivos } from './demandas.js';

const ativos = new Map();
const MAX_REPLAY_BYTES = 2 * 1024 * 1024;
const MAX_FILA_BYTES = MAX_REPLAY_BYTES + 1024 * 1024;
const decodificador = new TextDecoder();

function criarDistribuidor(resposta, aoTerminar) {
  const paineis = new Set();
  const historico = [];
  const pendentes = new Map();
  let bytes = 0;
  let terminou = false;

  function fechar(painel) {
    paineis.delete(painel);
    try { painel.close(); } catch { /* o cliente já desconectou */ }
  }

  function emitir(painel, parte) {
    if (painel.desiredSize < 0) return fechar(painel);
    try { painel.enqueue(parte); } catch { paineis.delete(painel); }
  }

  const conclusao = (async () => {
    try {
      for await (const parte of resposta.body) {
        const texto = decodificador.decode(parte);
        let evento = null;
        if (texto.startsWith('data: ')) {
          try { evento = JSON.parse(texto.slice(6)); } catch { /* comentário ou quadro inválido */ }
        }
        // Keepalive mantém só as conexões atuais. Não ocupa memória de replay.
        if (evento) {
          if (evento.tipo === 'aprovacao') pendentes.set(evento.requestId, parte);
          if (evento.tipo === 'aprovacao_fim') pendentes.delete(evento.requestId);
          historico.push({ parte, evento });
          bytes += parte.byteLength;
          while (bytes > MAX_REPLAY_BYTES && historico.length > 1) bytes -= historico.shift().parte.byteLength;
        }
        for (const painel of paineis) emitir(painel, parte);
      }
    } catch {
      const parte = new TextEncoder().encode(`data: ${JSON.stringify({ tipo: 'erro', mensagem: 'O acompanhamento foi interrompido. Reabra a demanda para reconectar.' })}\n\n`);
      for (const painel of paineis) emitir(painel, parte);
    } finally {
      terminou = true;
      for (const painel of paineis) fechar(painel);
      aoTerminar();
    }
  })();

  function assinar() {
    let painel;
    const corpo = new ReadableStream({
      start(controlador) {
        painel = controlador;
        // Autorizações antigas nunca reaparecem por replay. O cartão atual vem do pedido ainda pendente.
        for (const { parte, evento } of historico) {
          if (evento.tipo !== 'aprovacao' && evento.tipo !== 'aprovacao_fim') emitir(painel, parte);
        }
        for (const parte of pendentes.values()) emitir(painel, parte);
        if (terminou) fechar(painel);
        else paineis.add(painel);
      },
      cancel() { paineis.delete(painel); },
    }, { highWaterMark: MAX_FILA_BYTES, size: (parte) => parte.byteLength });
    return new Response(corpo, { status: 200, headers: resposta.headers });
  }
  return { assinar, conclusao };
}

export function acompanharRun(env, runId, fetchFn = fetch) {
  const chave = `${env.FRANK_PASTA_DE_DADOS}\n${runId}`;
  if (ativos.has(chave)) return ativos.get(chave);
  const inicio = abrirEventos(env, runId, fetchFn).then((resposta) => criarDistribuidor(resposta, () => {
    if (ativos.get(chave) === inicio) ativos.delete(chave);
  }));
  ativos.set(chave, inicio);
  inicio.catch(() => { if (ativos.get(chave) === inicio) ativos.delete(chave); });
  return inicio;
}

export async function assinarEventos(env, runId, fetchFn = fetch) {
  return (await acompanharRun(env, runId, fetchFn)).assinar();
}

export async function retomarAcompanhamentos(env, fetchFn = fetch) {
  if (!env.HERMES_API_URL || !env.HERMES_API_KEY) return { retomados: 0, falhas: 0 };
  const runs = await listarRunsAtivos(env);
  let retomados = 0;
  let falhas = 0;
  for (const { runId } of runs) {
    try { await acompanharRun(env, runId, fetchFn); retomados += 1; }
    catch { falhas += 1; }
  }
  return { retomados, falhas };
}
