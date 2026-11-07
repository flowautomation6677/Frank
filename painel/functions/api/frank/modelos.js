import { tratarErros } from '../../_lib/http.js';
import { responderModelos } from '../../_lib/ponte.js';

export function onRequestGet({ env }) {
  return tratarErros(() => responderModelos(env));
}
