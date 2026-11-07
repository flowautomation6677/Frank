import { ErroHttp, responderErro } from '../_lib/http.js';

function codigosIguais(recebido, esperado) {
  if (recebido.length !== esperado.length) return false;
  let diferenca = 0;
  for (let indice = 0; indice < esperado.length; indice += 1) {
    diferenca |= recebido.charCodeAt(indice) ^ esperado.charCodeAt(indice);
  }
  return diferenca === 0;
}

export function onRequest({ request, env, next }) {
  const origem = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  // Mesmo loopback recebe POSTs simples de outras páginas. CORS sozinho não impede o efeito.
  if ((origem !== null && origem !== new URL(request.url).origin) || (site && site !== 'same-origin' && site !== 'none')) {
    return responderErro(new ErroHttp(403, 'Origem não autorizada. Abra o painel do Frank no endereço do servidor.'));
  }
  if (request.method === 'GET' && new URL(request.url).pathname === '/api/saude') return next();
  const esperado = env.FRANK_ACCESS_CODE;
  if (esperado && !codigosIguais(request.headers.get('x-frank-code') ?? '', esperado)) {
    return responderErro(new ErroHttp(401, 'Código de acesso ausente ou incorreto. Informe o código do Frank para continuar.'));
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const tipo = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (tipo !== 'application/json') return responderErro(new ErroHttp(415, 'Envie o pedido como application/json.'));
  }
  return next();
}
