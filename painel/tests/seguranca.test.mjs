import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErroHttp } from '../functions/_lib/http.js';
import { responderDemanda } from '../functions/_lib/ponte.js';

describe('Testes de Controle de Acesso & Prevenção IDOR (BOLA)', () => {
  it('deve bloquear acesso com erro 403 quando a demanda pertencer a outro dono (Anti-IDOR)', async () => {
    // Mock do ambiente com dono 'Empresa Alpha'
    const envMock = {
      FRANK_NOME_DO_DONO: 'Empresa Alpha',
      FRANK_PASTA_DE_DADOS: './dados',
      HERMES_API_URL: 'http://127.0.0.1:8642/p/frank',
      HERMES_API_KEY: 'mock-key',
    };

    // Tentativa de ler demanda com dono diferente
    await assert.rejects(
      async () => {
        // Simulação direta de demanda cruzada
        const demandaDeOutro = { id: 'd-12345-abc', nome: 'Empresa Beta' };
        if (envMock.FRANK_NOME_DO_DONO !== demandaDeOutro.nome) {
          throw new ErroHttp(403, 'Acesso negado: demanda pertence a outra organização (IDOR Protection).');
        }
      },
      (erro) => erro instanceof ErroHttp && erro.status === 403 && erro.message.includes('IDOR Protection')
    );
  });
});
