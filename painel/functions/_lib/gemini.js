// Só a voz passa pela API do Google: a sessão do Gemini Live. O cérebro do Frank é o Hermes (ponte.js).
import config from '../../config/frank.js';
import { ErroHttp, chamarFornecedor, lerCorpoJson, lerJsonDoFornecedor, responderJson } from './http.js';
import { cumprimentoDoMomento, empresaDoDono, momentoDaConversa, montarSessaoGemini, nomeDoDono, normalizarNome } from './frank.js';

// O aluno não mexe no .env: quem grava as chaves é o instalador, e o comando time-do-frank troca.
export const MOTIVO_SEM_GEMINI = 'Falta a chave da voz. No terminal da VPS, rode: time-do-frank voz';

// As chaves novas do AI Studio (auth keys, "AQ.…") só valem no header x-goog-api-key. O token efêmero leva o setup
// inteiro em bidiGenerateContentSetup (no SDK, liveConnectConstraints) e só abre o endpoint Constrained.
const URL_DO_TOKEN = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';
export const URL_DO_WEBSOCKET = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
// Uma sessão por token, aberta no primeiro minuto; a sessão aberta dura até o fim do prazo do token.
const PRAZO_DO_TOKEN_MS = 30 * 60_000;
const PRAZO_PARA_ABRIR_MS = 60_000;

// FRANK_VOZ escolhe a voz padrão entre as da lista, sem diferença de caixa. Fora da lista, vale a padrão do config.
export function vozDoEnv(env) {
  const pedida = typeof env?.FRANK_VOZ === 'string' ? env.FRANK_VOZ.trim().toLowerCase() : '';
  return pedida ? config.geminiLive.vozes.find((voz) => voz.id.toLowerCase() === pedida)?.id ?? null : null;
}

export function vozPadraoDoGemini(env) {
  return vozDoEnv(env) ?? config.geminiLive.vozPadrao;
}

function chaveDoGemini(env) {
  if (!env.GEMINI_API_KEY) throw new ErroHttp(503, MOTIVO_SEM_GEMINI);
  return env.GEMINI_API_KEY;
}

function lerNome(valor) {
  if (valor !== undefined && typeof valor !== 'string') throw new ErroHttp(400, 'nome precisa ser texto.');
  return normalizarNome(valor);
}

export async function criarSessaoGemini(request, env, fetchFn = fetch, agora = Date.now) {
  const chave = chaveDoGemini(env);
  const corpo = await lerCorpoJson(request);
  const { geminiLive } = config;
  const voz = corpo.voz || vozPadraoDoGemini(env);
  if (!geminiLive.vozes.some((item) => item.id === voz)) {
    throw new ErroHttp(400, `Voz fora da lista do Gemini Live. Use uma destas: ${geminiLive.vozes.map((item) => item.id).join(', ')}.`);
  }
  const setup = montarSessaoGemini({
    modelo: geminiLive.modelo,
    voz,
    nome: lerNome(corpo.nome) || nomeDoDono(env),
    empresa: empresaDoDono(env),
    momento: momentoDaConversa({ fuso: corpo.fuso }),
    cumprimento: cumprimentoDoMomento({ fuso: corpo.fuso }),
  });
  const inicio = agora();

  const resposta = await chamarFornecedor(
    fetchFn,
    URL_DO_TOKEN,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': chave, 'content-type': 'application/json' },
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(inicio + PRAZO_DO_TOKEN_MS).toISOString(),
        newSessionExpireTime: new Date(inicio + PRAZO_PARA_ABRIR_MS).toISOString(),
        bidiGenerateContentSetup: setup,
      }),
    },
    { fornecedor: 'Google', acao: 'criar a sessão do Gemini Live', segredos: [chave], timeoutMs: 15000 },
  );
  const dados = await lerJsonDoFornecedor(resposta, 'Google');
  if (typeof dados?.name !== 'string' || !dados.name) throw new ErroHttp(502, 'O Google respondeu sem o token da sessão do Gemini Live.');
  return responderJson(200, { token: dados.name, modelo: setup.model, endereco: URL_DO_WEBSOCKET });
}
