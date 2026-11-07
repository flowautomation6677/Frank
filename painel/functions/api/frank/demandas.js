import { tratarErros } from '../../_lib/http.js';
import { criarDemanda, responderDemandas } from '../../_lib/ponte.js';

export function onRequestGet({ env }) {
  return tratarErros(() => responderDemandas(env));
}

export function onRequestPost({ request, env }) {
  return tratarErros(() => criarDemanda(request, env));
}
