import { responderJson, tratarErros } from '../../_lib/http.js';
import { quadroParaOPainel } from '../../_lib/quadro.js';

// O painel pergunta a cada 5 s com a aba visível; sem navegador aberto, a CLI do Hermes nem roda.
export function onRequestGet({ env }) {
  return tratarErros(async () => responderJson(200, await quadroParaOPainel(env)));
}
