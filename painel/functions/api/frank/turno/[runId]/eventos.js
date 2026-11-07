import { tratarErros } from '../../../../_lib/http.js';
import { assinarEventos } from '../../../../_lib/acompanhamento.js';

export function onRequestGet({ env, params }) {
  return tratarErros(() => assinarEventos(env, params.runId));
}
