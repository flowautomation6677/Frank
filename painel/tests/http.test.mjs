import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroHttp,
  omitirSegredos,
  responderJson,
  validarUrlSegura,
} from '../functions/_lib/http.js';

describe('Módulo HTTP & Validações de Segurança (AppSec)', () => {
  it('deve formatar respostas JSON corretamente com no-store', () => {
    const resp = responderJson(200, { status: 'ok' });
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(resp.headers.get('cache-control'), 'no-store');
  });

  it('deve ocultar chaves de API sensíveis em textos e mensagens de erro', () => {
    const textoComChave = 'Erro ao conectar com OpenAI usando sk-proj-1234567890abcdefghijklmnopqrstuvwxyz';
    const textoLimpo = omitirSegredos(textoComChave, []);
    assert.equal(textoLimpo.includes('sk-proj-'), false);
    assert.equal(textoLimpo.includes('[chave omitida]'), true);
  });

  it('deve validar URLs seguras de fornecedores externos', () => {
    const urlValida = validarUrlSegura('https://api.openai.com/v1/chat/completions', false);
    assert.equal(urlValida.hostname, 'api.openai.com');
  });

  it('deve bloquear ataques SSRF para endpoints de metadados de nuvem (169.254.169.254)', () => {
    assert.throws(
      () => validarUrlSegura('http://169.254.169.254/latest/meta-data/', false),
      (erro) => erro instanceof ErroHttp && erro.status === 403 && erro.message.includes('SSRF Protection')
    );
  });

  it('deve bloquear requisições externas para loopback quando não permitido', () => {
    assert.throws(
      () => validarUrlSegura('http://127.0.0.1:9000/admin', false),
      (erro) => erro instanceof ErroHttp && erro.status === 403
    );
  });

  it('deve permitir loopback para APIs internas quando explicitamente habilitado', () => {
    const urlInterna = validarUrlSegura('http://127.0.0.1:8642/health', true);
    assert.equal(urlInterna.port, '8642');
  });
});
