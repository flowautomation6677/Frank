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

// `fetchFn` é chamada como função solta: no Workers, `objeto.fetch(...)` lança "Illegal invocation".
export async function chamarFornecedor(fetchFn, url, init, { fornecedor, acao, segredos, timeoutMs }) {
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
