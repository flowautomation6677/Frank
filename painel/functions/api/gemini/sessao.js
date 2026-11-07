import { tratarErros } from '../../_lib/http.js';
import { criarSessaoGemini } from '../../_lib/gemini.js';

export function onRequestPost({ request, env }) {
  return tratarErros(() => criarSessaoGemini(request, env));
}
