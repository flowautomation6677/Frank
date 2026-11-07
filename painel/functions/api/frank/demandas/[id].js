import { tratarErros } from '../../../_lib/http.js';
import { responderDemanda } from '../../../_lib/ponte.js';

export function onRequestGet({ env, params }) {
  return tratarErros(() => responderDemanda(env, params.id));
}
