// Só a voz passa pela API da OpenAI: a sessão do GPT Live, motor opcional. O cérebro do Frank é o Hermes (ponte.js).
import config from '../../config/frank.js';
import { ErroHttp, chamarFornecedor, lerCorpoJson, lerJsonDoFornecedor, responderJson } from './http.js';
import { cumprimentoDoMomento, empresaDoDono, momentoDaConversa, montarSessaoLive, nomeDoDono, normalizarNome } from './frank.js';

export const MOTIVO_SEM_OPENAI = 'Adicione OPENAI_API_KEY no .env para ligar o GPT Live.';

const URL_DA_SESSAO = 'https://api.openai.com/v1/live/sessions';
const LIMITE_DO_SDP = 20000;

function chaveDaOpenai(env) {
  if (!env.OPENAI_API_KEY) throw new ErroHttp(503, MOTIVO_SEM_OPENAI);
  return env.OPENAI_API_KEY;
}

function cabecalhosOpenai(chave) {
  return { authorization: `Bearer ${chave}`, 'content-type': 'application/json' };
}

function lerNome(valor) {
  if (valor !== undefined && typeof valor !== 'string') throw new ErroHttp(400, 'nome precisa ser texto.');
  return normalizarNome(valor);
}

export async function criarSessaoLive(request, env, fetchFn = fetch) {
  const chave = chaveDaOpenai(env);
  const corpo = await lerCorpoJson(request);
  if (typeof corpo.sdp !== 'string' || !corpo.sdp.startsWith('v=0') || corpo.sdp.length > LIMITE_DO_SDP) {
    throw new ErroHttp(400, 'Envie em sdp a oferta SDP do navegador, o texto que começa com v=0.');
  }
  const { gptLive } = config;
  const voz = corpo.voz ?? gptLive.vozPadrao;
  if (!gptLive.vozes.includes(voz)) {
    throw new ErroHttp(400, `Voz fora da lista do GPT Live. Use uma destas: ${gptLive.vozes.join(', ')}.`);
  }
  const sessao = montarSessaoLive({
    modelo: gptLive.modelo,
    voz,
    nome: lerNome(corpo.nome) || nomeDoDono(env),
    empresa: empresaDoDono(env),
    momento: momentoDaConversa({ fuso: corpo.fuso }),
    cumprimento: cumprimentoDoMomento({ fuso: corpo.fuso }),
  });

  const resposta = await chamarFornecedor(
    fetchFn,
    URL_DA_SESSAO,
    { method: 'POST', headers: cabecalhosOpenai(chave), body: JSON.stringify({ session: sessao, transport: { type: 'webrtc', sdp: corpo.sdp } }) },
    { fornecedor: 'OpenAI', acao: 'criar a sessão do GPT Live', segredos: [chave], timeoutMs: 20000 },
  );
  const dados = await lerJsonDoFornecedor(resposta, 'OpenAI');
  if (typeof dados?.session?.id !== 'string' || typeof dados?.transport?.sdp !== 'string') {
    throw new ErroHttp(502, 'A OpenAI respondeu sem o id da sessão ou sem a resposta SDP.');
  }
  return responderJson(200, { sessionId: dados.session.id, sdp: dados.transport.sdp });
}
