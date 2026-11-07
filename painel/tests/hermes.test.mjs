import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exigirHermes,
  separarAgente,
  lerEntrega,
  resolverCerebro,
  corpoDoRun,
  normalizarEvento,
  MOTIVO_SO_LOCAL,
  MOTIVO_SEM_HERMES,
} from '../functions/_lib/hermes.js';
import { ErroHttp } from '../functions/_lib/http.js';

test('Módulo Hermes & Orquestração Multi-Agente', async (t) => {
  await t.test('exigirHermes: deve validar e formatar dados de conexão local do Hermes', () => {
    const envValido = {
      FRANK_PASTA_DE_DADOS: 'C:\\Users\\usuario\\AppData\\Local\\TimeDoFrank',
      HERMES_API_URL: 'http://127.0.0.1:8642/',
      HERMES_API_KEY: 'test-secret-key-12345',
    };

    const hermes = exigirHermes(envValido);
    assert.equal(hermes.base, 'http://127.0.0.1:8642');
    assert.equal(hermes.origem, 'http://127.0.0.1:8642');
    assert.equal(hermes.chave, 'test-secret-key-12345');
  });

  await t.test('exigirHermes: deve lançar erro 503 se executado fora do ambiente com pasta de dados', () => {
    assert.throws(
      () => exigirHermes({ HERMES_API_URL: 'http://127.0.0.1:8642', HERMES_API_KEY: 'abc' }),
      (err) => err instanceof ErroHttp && err.status === 503 && err.message === MOTIVO_SO_LOCAL
    );
  });

  await t.test('exigirHermes: deve lançar erro 503 se credenciais de API estiverem ausentes', () => {
    assert.throws(
      () => exigirHermes({ FRANK_PASTA_DE_DADOS: 'C:\\Dados' }),
      (err) => err instanceof ErroHttp && err.status === 503 && err.message === MOTIVO_SEM_HERMES
    );
  });

  await t.test('separarAgente: deve identificar agente e separar tarefa a partir do prefixo', () => {
    const res1 = separarAgente('[Renata] Desenvolver texto persuasivo de vendas');
    assert.equal(res1.agente, 'renata');
    assert.equal(res1.tarefa, 'Desenvolver texto persuasivo de vendas');
    assert.equal(res1.revisao, false);

    const res2 = separarAgente('[Revisão] Analisar consistência de métricas');
    assert.equal(res2.agente, null);
    assert.equal(res2.tarefa, 'Analisar consistência de métricas');
    assert.equal(res2.revisao, true);

    const res3 = separarAgente('Tarefa geral sem prefixo');
    assert.equal(res3.agente, null);
    assert.equal(res3.tarefa, 'Tarefa geral sem prefixo');
    assert.equal(res3.revisao, false);
  });

  await t.test('lerEntrega: deve decodificar JSON estruturado do resumo da entrega e filtrar markdown', () => {
    const jsonStr = '```json\n{"titulo": "Plano Estratégico", "texto": "Conteúdo validado", "tipo": "estrategia", "arquivo": "docs/plano.md", "pendencias": ["Definir verba"]}\n```';
    const entrega = lerEntrega(jsonStr, 'Tarefa Default');

    assert.equal(entrega.titulo, 'Plano Estratégico');
    assert.equal(entrega.texto, 'Conteúdo validado');
    assert.equal(entrega.tipo, 'estrategia');
    assert.equal(entrega.arquivo, 'docs/plano.md');
    assert.deepEqual(entrega.pendencias, ['Definir verba']);
  });

  await t.test('lerEntrega: deve realizar fallback gracioso se resumo for texto livre', () => {
    const entrega = lerEntrega('Texto simples retornado diretamente pelo agente.', 'Tarefa Original');
    assert.equal(entrega.titulo, 'Tarefa Original');
    assert.equal(entrega.texto, 'Texto simples retornado diretamente pelo agente.');
  });

  await t.test('resolverCerebro: deve validar provedor e modelo disponíveis', () => {
    const catalogo = {
      padrao: { provedor: 'openai-api', modelo: 'gpt-4o', esforco: null },
      provedores: [
        {
          id: 'openai-api',
          nome: 'OpenAI',
          modelos: ['gpt-4o', 'o3-mini'],
          esforcos: ['baixo', 'medio', 'alto'],
          rapidos: ['gpt-4o'],
        },
      ],
    };

    const resolvido = resolverCerebro(
      { provedor: 'openai-api', modelo: 'o3-mini', esforco: 'alto' },
      catalogo
    );
    assert.deepEqual(resolvido, { provedor: 'openai-api', modelo: 'o3-mini', esforco: 'alto' });

    assert.throws(
      () => resolverCerebro({ provedor: 'desconhecido', modelo: 'x' }, catalogo),
      (err) => err instanceof ErroHttp && err.status === 400
    );

    assert.throws(
      () => resolverCerebro({ provedor: 'openai-api', modelo: 'modelo-inexistente' }, catalogo),
      (err) => err instanceof ErroHttp && err.status === 400
    );
  });

  await t.test('corpoDoRun: deve construir payload seguro para a API do Hermes', () => {
    const payload = corpoDoRun({
      input: 'Gerar relatório',
      historico: [{ role: 'user', content: 'Olá' }],
      cerebro: { provedor: 'openai-api', modelo: 'o3-mini', esforco: 'medio' },
      instrucoes: 'Seja conciso.',
    });

    assert.equal(payload.input, 'Gerar relatório');
    assert.equal(payload.provider, 'openai-api');
    assert.equal(payload.model, 'o3-mini');
    assert.equal(payload.instructions, 'Seja conciso.');
    assert.deepEqual(payload.model_options, { reasoning_effort: 'medium' });
  });

  await t.test('normalizarEvento: deve converter eventos internos do Hermes para eventos padronizados do painel', () => {
    const evTool = normalizarEvento({
      event: 'tool.started',
      tool: 'consultar-banco',
      preview: 'Lendo dados da empresa',
    });
    assert.equal(evTool.tipo, 'ferramenta');
    assert.equal(evTool.nome, 'consultar-banco');
    assert.equal(evTool.fase, 'inicio');

    const evFim = normalizarEvento({
      event: 'run.completed',
      output: 'Aqui está sua resposta.\nMEDIA:c:\\temp\\print.png',
      runtime: { provider: 'openai-api', model: 'gpt-4o' },
    });
    assert.equal(evFim.tipo, 'fim');
    assert.equal(evFim.fala, 'Aqui está sua resposta.');
    assert.equal(evFim.provedor, 'openai-api');
    assert.equal(evFim.modelo, 'gpt-4o');
  });
});

