import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  cifrarDados,
  decifrarDados,
  mascararChave,
  CofreDeSegredos,
} from '../functions/_lib/cofre.js';
import {
  onRequestGet as getCofreApi,
  onRequestPost as postCofreApi,
} from '../functions/api/frank/cofre.js';

test('Módulo Cofre Centralizado de Segredos (AES-256-GCM & AppSec)', async (t) => {
  const senhaMestra = 'senha-super-secreta-para-testes-12345';

  await t.test('cifrarDados e decifrarDados: deve cifrar e decifrar com integridade criptográfica AES-256-GCM', () => {
    const dadosOriginais = {
      GEMINI_API_KEY: 'AIzaSyA1234567890BCDEFGHIJKLMNOPQRS',
      OPENAI_API_KEY: 'sk-proj-1234567890abcdefghijklmnopqrstuvwxyz',
      TELEGRAM_BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
    };

    const payload = cifrarDados(dadosOriginais, senhaMestra);

    assert.equal(payload.cifra.algoritmo, 'aes-256-gcm');
    assert.equal(payload.kdf.algoritmo, 'pbkdf2');
    assert.ok(payload.cifra.dadosCifrados.length > 0);
    assert.ok(payload.cifra.authTag.length > 0);
    assert.ok(payload.cifra.iv.length > 0);

    // Decifragem com senha correta
    const decifrado = decifrarDados(payload, senhaMestra);
    assert.deepEqual(decifrado, dadosOriginais);
  });

  await t.test('decifrarDados: deve rejeitar com erro caso o payload cifrado seja adulterado (Auth Tag Tamper Protection)', () => {
    const payload = cifrarDados({ segredo: 'valor' }, senhaMestra);

    // Simula adulteração de 1 caractere no texto cifrado
    const corrupto = {
      ...payload,
      cifra: {
        ...payload.cifra,
        dadosCifrados: payload.cifra.dadosCifrados.replace(/^[0-9a-f]/, 'a' === payload.cifra.dadosCifrados[0] ? 'b' : 'a'),
      },
    };

    assert.throws(
      () => decifrarDados(corrupto, senhaMestra),
      /unable to authenticate data|bad decrypt|Unsupported state/i
    );
  });

  await t.test('decifrarDados: deve rejeitar com erro caso senha mestra incorreta seja utilizada', () => {
    const payload = cifrarDados({ chave: 'xyz' }, senhaMestra);
    assert.throws(
      () => decifrarDados(payload, 'senha-incorreta-errada-999'),
      /unable to authenticate data|bad decrypt|Unsupported state/i
    );
  });

  await t.test('mascararChave: deve ocultar segredos evitando vazamento em logs e respostas', () => {
    assert.equal(mascararChave(''), '(não configurada)');
    assert.equal(mascararChave(null), '(não configurada)');
    assert.equal(mascararChave('1234'), '****');

    // Chave Google AI Studio
    const geminiMask = mascararChave('AIzaSyD-TESTE_KEY_EXEMPLO_1234');
    assert.match(geminiMask, /^AIzaSy\*\*\*\*\.\.\.1234$/);

    // Chave OpenAI
    const openaiMask = mascararChave('sk-proj-TESTE_KEY_EXEMPLO_5678');
    assert.match(openaiMask, /^sk-\*\*\*\*\.\.\.5678$/);

    // Token Telegram
    const tgMask = mascararChave('123456789:ABCdefGHIjkl9999');
    assert.match(tgMask, /^1234\*\*\*\*9999$/);
  });

  await t.test('CofreDeSegredos: deve armazenar, recuperar e respeitar precedência de variáveis de ambiente', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-vault-test-'));
    const caminhoCofre = path.join(tempDir, 'test.vault.json');

    try {
      const cofre = new CofreDeSegredos({
        caminhoCofre,
        senhaMestra,
        env: {},
      });

      // 1. Grava no cofre
      cofre.definir('GEMINI_API_KEY', 'AIzaSyChaveGravadaNoCofre1234');
      assert.equal(cofre.obter('GEMINI_API_KEY'), 'AIzaSyChaveGravadaNoCofre1234');

      // 2. Precedência de ambiente: se process.env / envContexto tiver chave, ela deve ter prioridade
      const envComOverride = {
        GEMINI_API_KEY: 'AIzaSyChaveInjetadaViaDocker9999',
      };
      const resolvida = cofre.obter('GEMINI_API_KEY', envComOverride);
      assert.equal(resolvida, 'AIzaSyChaveInjetadaViaDocker9999');

      // 3. Injeção em tempo de execução
      const envAlvo = {};
      cofre.injetarNoAmbiente(envAlvo);
      assert.equal(envAlvo.GEMINI_API_KEY, 'AIzaSyChaveGravadaNoCofre1234');

      // 4. Listagem mascarada
      const lista = cofre.listarMascarado();
      const itemGemini = lista.find((i) => i.chave === 'GEMINI_API_KEY');
      assert.ok(itemGemini);
      assert.equal(itemGemini.configurado, true);
      assert.equal(itemGemini.origem, 'cofre criptografado');
      assert.match(itemGemini.valorMascarado, /^AIzaSy/);

      // 5. Remoção
      const removido = cofre.remover('GEMINI_API_KEY');
      assert.equal(removido, true);
      assert.equal(cofre.obter('GEMINI_API_KEY'), null);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rotas da API do Cofre: deve listar mascarado e salvar chaves de forma protegida', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-vault-api-test-'));
    const caminhoCofre = path.join(tempDir, 'api.vault.json');
    const env = {
      FRANK_VAULT_PATH: caminhoCofre,
      FRANK_VAULT_KEY: senhaMestra,
    };

    try {
      // 1. POST /api/frank/cofre
      const reqPost = new Request('http://localhost:8787/api/frank/cofre', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chave: 'OPENAI_API_KEY',
          valor: 'sk-proj-teste1234567890abcdefghijklmnopqrstuvwxyz1234',
        }),
      });

      const resPost = await postCofreApi({ request: reqPost, env });
      assert.equal(resPost.status, 200);
      const dataPost = await resPost.json();
      assert.equal(dataPost.configurado, true);
      assert.match(dataPost.valorMascarado, /^sk-\*\*\*\*/);

      // Valida injeção no env
      assert.equal(env.OPENAI_API_KEY, 'sk-proj-teste1234567890abcdefghijklmnopqrstuvwxyz1234');

      // 2. GET /api/frank/cofre
      const resGet = await getCofreApi({ env });
      assert.equal(resGet.status, 200);
      const dataGet = await resGet.json();
      assert.equal(dataGet.cofre.status, 'ativo');
      const itemOpenai = dataGet.cofre.segredos.find((s) => s.chave === 'OPENAI_API_KEY');
      assert.ok(itemOpenai);
      assert.equal(itemOpenai.configurado, true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
