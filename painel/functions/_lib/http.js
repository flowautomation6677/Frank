// Só Web APIs: as rotas de functions/ usam Request e Response, como no Cloudflare Pages.

export class ErroHttp extends Error {
  constructor(status, mensagem, detalhe, opcoes) {
    super(mensagem, opcoes);
    this.name = 'ErroHttp';
    this.status = status;
    this.detalhe = detalhe;
  }
}

export function responderJson(status, corpo) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function responderErro(erro) {
  const corpo = erro.detalhe ? { erro: erro.message, detalhe: erro.detalhe } : { erro: erro.message };
  return responderJson(erro.status, corpo);
}

export async function tratarErros(executar) {
  try {
    return await executar();
  } catch (erro) {
    if (erro instanceof ErroHttp) return responderErro(erro);
    throw erro;
  }
}

export async function lerCorpoJson(request) {
  let corpo;
  try {
    corpo = await request.json();
  } catch (erro) {
    throw new ErroHttp(400, 'O corpo da requisição precisa ser JSON válido.', undefined, { cause: erro });
  }
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new ErroHttp(400, 'O corpo da requisição precisa ser um objeto JSON.');
  }
  return corpo;
}

export function omitirSegredos(texto, segredos) {
  const semChaves = segredos.filter(Boolean).reduce((atual, segredo) => atual.split(segredo).join('[chave omitida]'), texto);
  // A OpenAI devolve a chave mascarada ("sk-abc1****wxyz") no erro 401; nem o trecho mascarado sai daqui.
  return semChaves.replace(/sk-[A-Za-z0-9*_-]{4,}/g, '[chave omitida]');
}

export async function lerJsonDoFornecedor(resposta, fornecedor) {
  try {
    return await resposta.json();
  } catch (erro) {
    throw new ErroHttp(502, `A ${fornecedor} respondeu com um corpo que não é JSON.`, undefined, { cause: erro });
  }
}

// Validador de SSRF (Server-Side Request Forgery)
const IPS_METADADOS_NUVEM = new Set(['169.254.169.254', 'metadata.google.internal', '169.254.170.2']);
const PREFIXOS_REDE_PRIVADA = ['10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', '192.168.'];

export function validarUrlSegura(urlBruta, permitirLoopback = false) {
  let url;
  try {
    url = new URL(urlBruta);
  } catch {
    throw new ErroHttp(400, 'URL inválida.');
  }
  const host = url.hostname.toLowerCase();
  
  // Bloqueio estrito de Metadados de Nuvem (AWS, GCP, Azure)
  if (IPS_METADADOS_NUVEM.has(host) || host.endsWith('.internal')) {
    throw new ErroHttp(403, 'Acesso bloqueado: requisição para endpoint de metadados de nuvem (SSRF Protection).');
  }
  
  // Bloqueio de Loopback se não for explicitamente permitido (para APIs locais)
  if (!permitirLoopback && (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('127.'))) {
    throw new ErroHttp(403, 'Acesso bloqueado: requisições externas para loopback não são permitidas (SSRF Protection).');
  }

  // Bloqueio de Redes Privadas
  if (!permitirLoopback && PREFIXOS_REDE_PRIVADA.some((prefixo) => host.startsWith(prefixo))) {
    throw new ErroHttp(403, 'Acesso bloqueado: requisições para redes privadas locais não são permitidas (SSRF Protection).');
  }

  return url;
}

// `fetchFn` é chamada como função solta: no Workers, `objeto.fetch(...)` lança "Illegal invocation".
export async function chamarFornecedor(fetchFn, url, init, { fornecedor, acao, segredos, timeoutMs }) {
  // Validação SSRF preventiva
  const permitirLocal = fornecedor === 'Hermes';
  validarUrlSegura(url, permitirLocal);

  let resposta;
  try {
    resposta = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (erro) {
    if (erro?.name === 'TimeoutError') {
      throw new ErroHttp(504, `A ${fornecedor} não respondeu em ${timeoutMs / 1000} s ao pedido para ${acao}.`, undefined, { cause: erro });
    }
    throw new ErroHttp(502, `Não foi possível falar com a ${fornecedor} para ${acao}.`, omitirSegredos(String(erro?.message ?? erro), segredos), { cause: erro });
  }
  if (!resposta.ok) {
    const detalhe = omitirSegredos(await resposta.text(), segredos).slice(0, 600);
    throw new ErroHttp(502, `A ${fornecedor} recusou o pedido para ${acao} (HTTP ${resposta.status}).`, detalhe);
  }
  return resposta;
}
