import { tratarErros } from '../../../../_lib/http.js';
import { decidirAprovacao } from '../../../../_lib/ponte.js';

export function onRequestPost({ request, env, params }) {
  return tratarErros(() => decidirAprovacao(request, env, params.runId));
}
