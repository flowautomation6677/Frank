import { ErroHttp, lerCorpoJson, responderJson, tratarErros } from '../../_lib/http.js';
import { obterServicoBanco } from '../../_lib/db/servico.js';

export function onRequestGet({ request, env }) {
  return tratarErros(async () => {
    const url = new URL(request.url);
    const blocoParam = url.searchParams.get('bloco');
    const servico = obterServicoBanco(env);

    if (blocoParam) {
      const blocoNum = Number(blocoParam);
      if (!Number.isInteger(blocoNum) || blocoNum < 1) {
        throw new ErroHttp(400, 'Parâmetro bloco precisa ser um número inteiro positivo.');
      }
      const itens = servico.conhecimento.listarPorBloco(blocoNum);
      return responderJson(200, { bloco: blocoNum, itens, total: itens.length });
    }

    const situacao = servico.conhecimento.obterSituacao();
    return responderJson(200, situacao);
  });
}

export function onRequestPut({ request, env }) {
  return tratarErros(async () => {
    const corpo = await lerCorpoJson(request);
    if (!corpo.id || typeof corpo.valor !== 'string') {
      throw new ErroHttp(400, 'Campos id e valor (string) são obrigatórios.');
    }

    const servico = obterServicoBanco(env);
    const atualizado = servico.conhecimento.atualizarValor(corpo.id, corpo.valor, Boolean(corpo.pendente));
    if (!atualizado) {
      throw new ErroHttp(404, `Item de conhecimento "${corpo.id}" não encontrado.`);
    }

    return responderJson(200, {
      mensagem: 'Item de conhecimento atualizado com sucesso.',
      item: atualizado,
    });
  });
}

