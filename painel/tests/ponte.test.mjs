import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTRUCAO_DO_DESCARTE,
  estadoDoCerebro,
  responderModelos,
} from '../functions/_lib/ponte.js';
import { esquecerModelos } from '../functions/_lib/hermes.js';

test('Módulo Ponte & Gestão do Cérebro LLM', async (t) => {
  t.beforeEach(() => {
    esquecerModelos();
  });

  await t.test('INSTRUCAO_DO_DESCARTE: deve conter diretriz explícita de segurança contra deleção de arquivos', () => {
    assert.match(INSTRUCAO_DO_DESCARTE, /não apague nem mexa no arquivo/i);
    assert.match(INSTRUCAO_DO_DESCARTE, /registro de decisões/i);
  });

  await t.test('estadoDoCerebro: deve reportar disponibilidade ativa quando Hermes responder opções de modelo', async () => {
    const env = {
      FRANK_PASTA_DE_DADOS: 'C:\\Dados',
      HERMES_API_URL: 'http://127.0.0.1:8642',
      HERMES_API_KEY: 'token-teste',
    };

    const mockFetch = async (url) => {
      assert.equal(url, 'http://127.0.0.1:8642/api/model/options');
      return new Response(
        JSON.stringify({
          model: 'gpt-4o',
          provider: 'openai-api',
          providers: [
            {
              slug: 'openai-api',
              name: 'OpenAI',
              authenticated: true,
              models: ['gpt-4o'],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const estado = await estadoDoCerebro(env, mockFetch);
    assert.equal(estado.disponivel, true);
    assert.equal(estado.motivo, null);
    assert.equal(estado.via, 'hermes');
    assert.equal(estado.padrao.modelo, 'gpt-4o');
    assert.equal(estado.padrao.provedor, 'openai-api');
  });

  await t.test('estadoDoCerebro: deve capturar falha de comunicação e reportar status indisponível sem travar a aplicação', async () => {
    const env = {
      FRANK_PASTA_DE_DADOS: 'C:\\Dados',
      HERMES_API_URL: 'http://127.0.0.1:8642',
      HERMES_API_KEY: 'token-teste',
    };

    const mockFetchFalha = async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:8642');
    };

    const estado = await estadoDoCerebro(env, mockFetchFalha);
    assert.equal(estado.disponivel, false);
    assert.match(estado.motivo, /não está respondendo/i);
    assert.equal(estado.padrao, null);
  });

  await t.test('responderModelos: deve retornar resposta HTTP 200 contendo cabeçalho no-store', async () => {
    const env = {
      FRANK_PASTA_DE_DADOS: 'C:\\Dados',
      HERMES_API_URL: 'http://127.0.0.1:8642',
      HERMES_API_KEY: 'token-teste',
    };

    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          model: 'gpt-4o',
          provider: 'openai-api',
          providers: [
            {
              slug: 'openai-api',
              authenticated: true,
              models: ['gpt-4o'],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const resposta = await responderModelos(env, mockFetch);
    assert.equal(resposta.status, 200);
    assert.equal(resposta.headers.get('cache-control'), 'no-store');
    const corpo = await resposta.json();
    assert.equal(corpo.padrao.modelo, 'gpt-4o');
    assert.equal(corpo.provedores[0].id, 'openai-api');
  });
});
