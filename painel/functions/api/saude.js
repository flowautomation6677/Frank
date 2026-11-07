// Identificação sem dados pessoais para o atalho conferir o serviço pelo túnel.
import { responderJson } from '../_lib/http.js';

export function onRequestGet() {
  return responderJson(200, { servico: 'painel-do-frank', versao: '0.3.10' });
}
