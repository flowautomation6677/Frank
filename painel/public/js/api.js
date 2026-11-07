export const SEM_API = 'Este servidor não tem a API do Frank. Rode node server.mjs na pasta do painel e abra http://localhost:8787.';
const FORA_DO_AR = 'Servidor fora do ar. Confira se o painel está rodando e se o túnel SSH está aberto, e recarregue a página.';
const TENTATIVAS_DE_CODIGO = 3;

export class ErroApi extends Error {
  constructor(mensagem, { status = 0, detalhe = '', corpo = null, cause } = {}) {
    super(mensagem, { cause });
    this.name = 'ErroApi';
    this.status = status;
    this.detalhe = detalhe;
    // Corpo JSON da resposta de erro, para campos além do `erro` (o 409 do turno traz `aprovacaoPendente`).
    this.corpo = corpo;
  }
}

async function erroDaResposta(resposta) {
  const tipo = resposta.headers.get('content-type') ?? '';
  if (!tipo.includes('application/json')) {
    return new ErroApi(resposta.status === 404 ? SEM_API : `O servidor respondeu ${resposta.status}.`, { status: resposta.status });
  }
  const corpo = await resposta.json().catch((erro) => ({ erro: '', detalhe: String(erro) }));
  return new ErroApi(corpo.erro || `O servidor respondeu ${resposta.status}.`, { status: resposta.status, detalhe: corpo.detalhe ?? '', corpo });
}

export function criarApi({ obterCodigo, pedirCodigo }) {
  async function requisitar(caminho, { metodo = 'GET', corpo, sinal, timeoutMs = 20_000, formato = 'json' } = {}) {
    for (let tentativa = 0; tentativa < TENTATIVAS_DE_CODIGO; tentativa += 1) {
      const cabecalhos = {};
      if (corpo !== undefined) cabecalhos['content-type'] = 'application/json';
      const codigo = obterCodigo();
      if (codigo) cabecalhos['x-frank-code'] = codigo;
      const sinais = [AbortSignal.timeout(timeoutMs)];
      if (sinal) sinais.push(sinal);

      let resposta;
      try {
        resposta = await fetch(caminho, {
          method: metodo,
          headers: cabecalhos,
          body: corpo === undefined ? undefined : JSON.stringify(corpo),
          signal: AbortSignal.any(sinais),
        });
      } catch (erro) {
        if (sinal?.aborted) throw erro;
        if (erro.name === 'TimeoutError') throw new ErroApi('O servidor demorou demais para responder.', { cause: erro });
        throw new ErroApi(FORA_DO_AR, { cause: erro });
      }

      if (resposta.status === 401) {
        const novoCodigo = await pedirCodigo();
        if (!novoCodigo) throw new ErroApi('Sem o código de acesso o servidor não libera o Frank.', { status: 401 });
        continue;
      }
      if (!resposta.ok) throw await erroDaResposta(resposta);
      // Para streams (SSE): o timeoutMs continua valendo para a leitura do corpo, então quem chama passa um prazo longo.
      if (formato === 'resposta') return resposta;
      if (formato === 'blob') return resposta.blob();
      if (!(resposta.headers.get('content-type') ?? '').includes('application/json')) {
        throw new ErroApi(SEM_API, { status: resposta.status });
      }
      return resposta.json();
    }
    throw new ErroApi('O código de acesso foi recusado. Confira com quem montou o servidor.', { status: 401 });
  }

  return {
    json: (caminho, opcoes) => requisitar(caminho, { ...opcoes, formato: 'json' }),
    blob: (caminho, opcoes) => requisitar(caminho, { ...opcoes, formato: 'blob' }),
    resposta: (caminho, opcoes) => requisitar(caminho, { ...opcoes, formato: 'resposta' }),
  };
}
