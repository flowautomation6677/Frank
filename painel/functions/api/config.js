import config from '../../config/frank.js';
import { responderJson } from '../_lib/http.js';
import { MOTIVO_SEM_OPENAI } from '../_lib/openai.js';
import { MOTIVO_SEM_GEMINI, vozPadraoDoGemini } from '../_lib/gemini.js';
import { empresaDoDono, nomeDoDono } from '../_lib/frank.js';
import { estadoDoCerebro } from '../_lib/ponte.js';

// dono: o nome e a empresa do .env (FRANK_NOME_DO_DONO e FRANK_NOME_DA_EMPRESA), vazios quando não vieram.
export async function onRequestGet({ env }) {
  const { gptLive, geminiLive } = config;
  const temOpenai = Boolean(env.OPENAI_API_KEY);
  const temGemini = Boolean(env.GEMINI_API_KEY);

  return responderJson(200, {
    motores: {
      geminiLive: {
        disponivel: temGemini,
        motivo: temGemini ? null : MOTIVO_SEM_GEMINI,
        modelo: geminiLive.modelo,
        vozes: geminiLive.vozes,
        vozPadrao: vozPadraoDoGemini(env),
      },
      gptLive: {
        disponivel: temOpenai,
        motivo: temOpenai ? null : MOTIVO_SEM_OPENAI,
        modelo: gptLive.modelo,
        vozes: gptLive.vozes,
        vozPadrao: gptLive.vozPadrao,
      },
    },
    cerebro: await estadoDoCerebro(env),
    dono: { nome: nomeDoDono(env), empresa: empresaDoDono(env) },
  });
}
