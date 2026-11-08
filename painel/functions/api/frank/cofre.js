import { ErroHttp, lerCorpoJson, responderJson, tratarErros } from '../../_lib/http.js';
import { obterCofre, mascararChave } from '../../_lib/cofre.js';

export function onRequestGet({ env }) {
  return tratarErros(async () => {
    const cofre = obterCofre({ env });
    const segredos = cofre.listarMascarado(env);
    return responderJson(200, {
      cofre: {
        status: 'ativo',
        algoritmo: 'AES-256-GCM',
        segredos,
        total: segredos.length,
      },
    });
  });
}

export function onRequestPost({ request, env }) {
  return tratarErros(async () => {
    const corpo = await lerCorpoJson(request);
    const { chave, valor } = corpo;

    if (!chave || typeof chave !== 'string') {
      throw new ErroHttp(400, 'Campo "chave" é obrigatório e deve ser texto.');
    }
    if (typeof valor !== 'string') {
      throw new ErroHttp(400, 'Campo "valor" é obrigatório e deve ser texto.');
    }

    const chaveFormatada = chave.trim().toUpperCase();
    if (!/^[A-Z0-9_]{3,64}$/.test(chaveFormatada)) {
      throw new ErroHttp(400, 'Nome de chave inválido. Use letras maiúsculas, números e sublinhados (ex: GEMINI_API_KEY).');
    }

    const cofre = obterCofre({ env });
    cofre.definir(chaveFormatada, valor);

    // Injeta em tempo de execução no env em memória
    if (env) {
      env[chaveFormatada] = valor.trim();
    }

    return responderJson(200, {
      mensagem: `Segredo "${chaveFormatada}" criptografado e salvo com sucesso no cofre.`,
      chave: chaveFormatada,
      configurado: true,
      valorMascarado: mascararChave(valor),
    });
  });
}
