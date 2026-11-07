import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { obterBanco } from '../functions/_lib/db/index.js';
import { fecharServicoBanco } from '../functions/_lib/db/servico.js';
import { statusMigracoes, executarMigracoes } from '../functions/_lib/db/migracoes.js';
import { AgenteRepository } from '../functions/_lib/db/repositorios/agente-repositorio.js';
import { ConhecimentoRepository } from '../functions/_lib/db/repositorios/conhecimento-repositorio.js';
import { DemandaRepository } from '../functions/_lib/db/repositorios/demanda-repositorio.js';
import { onRequestGet as getAgentes, onRequestPost as postAgentes } from '../functions/api/frank/agentes.js';
import {
  onRequestGet as getAgenteId,
  onRequestPut as putAgenteId,
  onRequestDelete as deleteAgenteId,
} from '../functions/api/frank/agentes/[id].js';
import { onRequestGet as getConhecimento, onRequestPut as putConhecimento } from '../functions/api/frank/conhecimento.js';

test('Módulo Banco de Dados, ORM & Registro Dinâmico de Agentes', async (t) => {
  let db;

  t.beforeEach(() => {
    db = obterBanco(':memory:', { forcarNovo: true });
  });

  t.afterEach(() => {
    fecharServicoBanco();
  });

  await t.test('Migrações: deve aplicar migrações SQL versionadas de forma transacional e idempotente', () => {
    const statusInicial = statusMigracoes(db);
    assert.equal(statusInicial.pendentes.length, 1);
    assert.equal(statusInicial.pendentes[0].versao, '001');

    const resultado = executarMigracoes(db);
    assert.equal(resultado.executadas.length, 1);
    assert.equal(resultado.executadas[0].versao, '001');

    // Segunda execução não deve reexecutar nada (idempotência)
    const statusFinal = statusMigracoes(db);
    assert.equal(statusFinal.pendentes.length, 0);
    assert.equal(statusFinal.aplicadas.length, 1);

    const reexecucao = executarMigracoes(db);
    assert.equal(reexecucao.executadas.length, 0);
  });

  await t.test('AgenteRepository: deve criar, consultar, atualizar e desativar agentes dinamicamente sem commits', () => {
    executarMigracoes(db);
    const repo = new AgenteRepository(db);

    // 1. Criar novo agente dinâmico
    const novo = repo.salvar({
      id: 'lucas',
      nome: 'Lucas',
      funcao: 'especialista em CRM e nutrição de leads',
      soul_prompt: 'Você é Lucas, especialista em automação e CRM da empresa.',
      provedor_padrao: 'gemini',
      modelo_padrao: 'gemini-2.5-flash',
      temperatura: 0.5,
      skills: [
        {
          nome: 'gerenciar-crm',
          descricao: 'Consulta e atualiza o funil de vendas',
          instrucoes_md: '# Gerenciar CRM\nConsulte o funil.',
        },
      ],
    });

    assert.equal(novo.id, 'lucas');
    assert.equal(novo.nome, 'Lucas');
    assert.equal(novo.ativo, true);
    assert.equal(novo.skills.length, 1);
    assert.equal(novo.skills[0].nome, 'gerenciar-crm');

    // 2. Atualizar prompt dinamicamente
    const atualizado = repo.salvar({
      id: 'lucas',
      nome: 'Lucas (Senior)',
      funcao: 'head de CRM e fidelização',
      soul_prompt: 'Você é Lucas, Head de CRM com foco em LTV elevado.',
    });
    assert.equal(atualizado.nome, 'Lucas (Senior)');
    assert.match(atualizado.soul_prompt, /LTV elevado/);

    // 3. Desativar dinamicamente
    repo.desativar('lucas');
    const desativado = repo.obterPorId('lucas');
    assert.equal(desativado.ativo, false);

    const listaAtivos = repo.listar({ apenasAtivos: true });
    assert.equal(listaAtivos.find((a) => a.id === 'lucas'), undefined);
  });

  await t.test('AgenteRepository: deve sincronizar agente dinâmico para a pasta de perfis do Hermes', () => {
    executarMigracoes(db);
    const repo = new AgenteRepository(db);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-sync-test-'));

    try {
      repo.salvar({
        id: 'sophia',
        nome: 'Sophia',
        funcao: 'analista de inteligência de mercado',
        soul_prompt: 'Você é Sophia, analista de inteligência competitiva.',
        skills: [{ nome: 'analisar-mercado', instrucoes_md: '# Analisar Mercado' }],
      });

      const pastaCriada = repo.sincronizarParaDisco('sophia', tempDir);
      assert.ok(fs.existsSync(path.join(pastaCriada, 'SOUL.md')));
      assert.ok(fs.existsSync(path.join(pastaCriada, 'config.yaml')));
      assert.ok(fs.existsSync(path.join(pastaCriada, 'DESCRICAO.txt')));
      assert.ok(fs.existsSync(path.join(pastaCriada, 'skills', 'analisar-mercado', 'SKILL.md')));

      const soulContent = fs.readFileSync(path.join(pastaCriada, 'SOUL.md'), 'utf-8');
      assert.match(soulContent, /inteligência competitiva/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('ConhecimentoRepository: deve persistir itens, calcular pendências em SQL e exportar markdown', () => {
    executarMigracoes(db);
    const repo = new ConhecimentoRepository(db);

    repo.salvarItem({
      bloco_numero: 1,
      bloco_nome: '1. Dados básicos',
      arquivo_referencia: 'empresa.md',
      secao: 'Identificação',
      chave: 'Nome Fantasia',
      valor: 'Flow Automation',
      pendente: false,
    });

    repo.salvarItem({
      bloco_numero: 1,
      bloco_nome: '1. Dados básicos',
      arquivo_referencia: 'empresa.md',
      secao: 'Identificação',
      chave: 'CNPJ',
      valor: 'a definir pelo dono',
      pendente: true,
    });

    const situacao = repo.obterSituacao();
    assert.equal(situacao.totalItens, 2);
    assert.equal(situacao.itensPendentes, 1);
    assert.equal(situacao.blocos[0].nome, '1. Dados básicos');
    assert.equal(situacao.blocos[0].pendentes, 1);

    // Atualiza valor via repositório
    const itemId = 'empresa.md:cnpj';
    const atualizado = repo.atualizarValor(itemId, '12.345.678/0001-90', false);
    assert.equal(atualizado.valor, '12.345.678/0001-90');
    assert.equal(atualizado.pendente, false);

    const situacaoApos = repo.obterSituacao();
    assert.equal(situacaoApos.itensPendentes, 0);
  });

  await t.test('DemandaRepository: deve persistir demandas e garantir isolamento por dono (Anti-IDOR)', () => {
    executarMigracoes(db);
    const repo = new DemandaRepository(db);

    repo.salvar({
      id: 'd-123456',
      dono_id: 'empresa-a',
      titulo: 'Campanha de Black Friday',
      status: 'ativa',
      historico: [{ role: 'user', content: 'Iniciar planejamento' }],
    });

    // Dono legítimo obtém a demanda
    const demandaA = repo.obterPorId('d-123456', 'empresa-a');
    assert.ok(demandaA);
    assert.equal(demandaA.titulo, 'Campanha de Black Friday');

    // Tentativa de acesso cruzado (IDOR) por outra empresa deve retornar null
    const demandaB = repo.obterPorId('d-123456', 'empresa-b');
    assert.equal(demandaB, null);
  });

  await t.test('Rotas da API de Agentes: deve listar, criar e atualizar agentes via HTTP Request/Response', async () => {
    const env = { FRANK_DATABASE_PATH: ':memory:' };

    // 1. POST /api/frank/agentes
    const reqPost = new Request('http://localhost:8787/api/frank/agentes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'marcos',
        nome: 'Marcos',
        funcao: 'Growth Hacker',
        soul_prompt: 'Você é Marcos, especialista em viralização.',
      }),
    });
    const resPost = await postAgentes({ request: reqPost, env });
    assert.equal(resPost.status, 201);
    const dataPost = await resPost.json();
    assert.equal(dataPost.agente.id, 'marcos');

    // 2. GET /api/frank/agentes
    const reqGet = new Request('http://localhost:8787/api/frank/agentes');
    const resGet = await getAgentes({ request: reqGet, env });
    assert.equal(resGet.status, 200);
    const dataGet = await resGet.json();
    assert.ok(dataGet.agentes.some((a) => a.id === 'marcos'));

    // 3. GET /api/frank/agentes/[id]
    const resGetId = await getAgenteId({ params: { id: 'marcos' }, env });
    assert.equal(resGetId.status, 200);
    const dataGetId = await resGetId.json();
    assert.equal(dataGetId.agente.nome, 'Marcos');

    // 4. PUT /api/frank/agentes/[id]
    const reqPut = new Request('http://localhost:8787/api/frank/agentes/marcos', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Marcos Growth',
        funcao: 'Head of Growth',
        soul_prompt: 'Prompt atualizado.',
      }),
    });
    const resPut = await putAgenteId({ params: { id: 'marcos' }, request: reqPut, env });
    assert.equal(resPut.status, 200);
    const dataPut = await resPut.json();
    assert.equal(dataPut.agente.nome, 'Marcos Growth');

    // 5. DELETE /api/frank/agentes/[id]
    const resDel = await deleteAgenteId({ params: { id: 'marcos' }, env });
    assert.equal(resDel.status, 200);
    const dataDel = await resDel.json();
    assert.equal(dataDel.ativo, false);
  });

  await t.test('Rotas da API de Conhecimento: deve reportar situação e atualizar campos via HTTP', async () => {
    const env = { FRANK_DATABASE_PATH: ':memory:' };

    // GET /api/frank/conhecimento
    const reqGet = new Request('http://localhost:8787/api/frank/conhecimento');
    const resGet = await getConhecimento({ request: reqGet, env });
    assert.equal(resGet.status, 200);

    // PUT /api/frank/conhecimento
    const reqPut = new Request('http://localhost:8787/api/frank/conhecimento', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'empresa.md:nome-comercial',
        valor: 'Flow Corp',
        pendente: false,
      }),
    });
    const resPut = await putConhecimento({ request: reqPut, env });
    assert.equal(resPut.status, 200);
    const dataPut = await resPut.json();
    assert.equal(dataPut.item.valor, 'Flow Corp');
    assert.equal(dataPut.item.pendente, false);
  });
});
