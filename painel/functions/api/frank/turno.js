import { tratarErros } from '../../_lib/http.js';
import { iniciarTurno } from '../../_lib/ponte.js';
import { acompanharRun } from '../../_lib/acompanhamento.js';

export async function onRequestPost({ request, env }) {
  const resposta = await tratarErros(() => iniciarTurno(request, env));
  if (resposta.ok) {
    const aceito = await resposta.clone().json();
    if (aceito.runId) {
      // Não depende de o navegador receber o POST ou abrir o primeiro SSE.
      acompanharRun(env, aceito.runId).catch(() => console.warn('[frank] não foi possível iniciar o acompanhamento; será retomado ao abrir a demanda.'));
    }
  }
  return resposta;
}
