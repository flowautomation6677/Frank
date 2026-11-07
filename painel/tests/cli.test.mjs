import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  trocarMarcadores,
  contarPendentes,
  aplicarFallbackConfig,
  criarBancoConhecimento,
  obterSituacaoBanco,
  BLOCO_FALLBACK_PADRAO,
} from '../../scripts/flow-cli.mjs';

test('Módulo CLI Unificada & Padronização de Scripts (flow-cli)', async (t) => {
  await t.test('trocarMarcadores: deve substituir placeholders pelo formato de onboarding sem alterar notas com >', () => {
    const modelo = [
      '> Como preencher: {{EXEMPLO: não altere notas}}',
      'Nome da empresa: {{EMPRESA: Nome Fantasia}}',
      'Segmento: {{SEGMENTO}}',
      'Público: ainda não informado; pergunte ao dono antes de escrever qualquer texto de venda',
    ].join('\n');

    const resultado = trocarMarcadores(modelo);
    const linhas = resultado.split('\n');

    assert.equal(linhas[0], '> Como preencher: {{EXEMPLO: não altere notas}}');
    assert.equal(linhas[1], 'Nome da empresa: a definir pelo dono (Nome Fantasia)');
    assert.equal(linhas[2], 'Segmento: a definir pelo dono');
    assert.equal(linhas[3], 'Público: a definir pelo dono');
  });

  await t.test('aplicarFallbackConfig: deve injetar bloco de fallback Multi-LLM em arquivo config.yaml', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-fallback-test-'));
    const configPath = path.join(tempDir, 'config.yaml');

    try {
      fs.writeFileSync(
        configPath,
        [
          'model: "gpt-4o"',
          'provider: "openai-api"',
          'fallback_providers:',
          '  - provider: gemini',
          '    model: "gemini-1.5-flash"',
        ].join('\n'),
        'utf-8'
      );

      const modificado = aplicarFallbackConfig(configPath, BLOCO_FALLBACK_PADRAO);
      assert.equal(modificado, true);

      const novoConteudo = fs.readFileSync(configPath, 'utf-8');
      assert.match(novoConteudo, /fallback_providers:/);
      assert.match(novoConteudo, /gemini-2\.5-flash/);
      assert.match(novoConteudo, /gpt-4o/);
      // O modelo antigo substituído não deve persistir
      assert.doesNotMatch(novoConteudo, /gemini-1\.5-flash/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('criarBancoConhecimento e obterSituacaoBanco: deve inicializar e auditar base de dados com segurança', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-banco-test-'));
    const pastaModelo = path.join(tempDir, 'modelo');
    const pastaBanco = path.join(tempDir, 'empresa', 'banco');

    fs.mkdirSync(pastaModelo, { recursive: true });
    fs.writeFileSync(
      path.join(pastaModelo, 'empresa.md'),
      '# Empresa\nNome: {{EMPRESA: Nome}}\n> Nota: {{IGNORAR}}\nMissão: {{MISSAO}}',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(pastaModelo, 'produtos-e-precos.md'),
      '# Produtos\nProduto 1: {{PRODUTO}}',
      'utf-8'
    );

    try {
      const criacao = criarBancoConhecimento(pastaBanco, pastaModelo);
      assert.equal(criacao.criados, 2);
      assert.equal(criacao.totalArquivos, 2);

      const situacao = obterSituacaoBanco(pastaBanco);
      assert.equal(situacao.existe, true);
      assert.equal(situacao.pendencias['1. Dados básicos'][0].arquivo, 'empresa.md');
      assert.equal(situacao.pendencias['1. Dados básicos'][0].pendentes, 2);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
