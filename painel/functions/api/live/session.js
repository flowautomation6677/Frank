import { tratarErros } from '../../_lib/http.js';
import { criarSessaoLive } from '../../_lib/openai.js';

export function onRequestPost({ request, env }) {
  return tratarErros(() => criarSessaoLive(request, env));
}
