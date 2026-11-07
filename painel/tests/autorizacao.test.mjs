import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  anotarDecisao,
  anotarPedido,
  decisaoPorVoz,
  pedidoPendente,
} from '../functions/_lib/autorizacao.js';

describe('Módulo de Autorização e Human-In-The-Loop (HITL)', () => {
  it('deve reconhecer respostas vocais afirmativas ignorando pontuação e o vocativo Frank', () => {
    assert.equal(decisaoPorVoz('Sim'), 'sim');
    assert.equal(decisaoPorVoz('Pode, Frank!'), 'sim');
    assert.equal(decisaoPorVoz('Manda ver Frank'), 'sim');
    assert.equal(decisaoPorVoz('Autorizo'), 'sim');
  });

  it('deve reconhecer respostas vocais negativas com segurança', () => {
    assert.equal(decisaoPorVoz('Não!'), 'nao');
    assert.equal(decisaoPorVoz('Nao, cancela'), null); // frase composta não exata
    assert.equal(decisaoPorVoz('Cancela'), 'nao');
    assert.equal(decisaoPorVoz('Não pode Frank'), 'nao');
  });

  it('deve retornar null para conversas ou frases neutras fora do vocabulário de decisão', () => {
    assert.equal(decisaoPorVoz('Como estão os números de tráfego de hoje?'), null);
    assert.equal(decisaoPorVoz('Talvez depois'), null);
  });

  it('deve anotar novos pedidos de autorização e evitar duplicatas pelo requestId', () => {
    const run = { runId: 'run-1', status: 'rodando', aprovacoes: [] };
    const p1 = anotarPedido(run, { requestId: 'req-100', runId: 'run-1', comando: 'dir', descricao: 'Listar' });
    assert.equal(p1.requestId, 'req-100');
    assert.equal(p1.decisao, null);

    // Repetição deve retornar o objeto existente
    const p2 = anotarPedido(run, { requestId: 'req-100', runId: 'run-1', comando: 'dir' });
    assert.equal(p2, p1);
    assert.equal(run.aprovacoes.length, 1);
  });

  it('deve registrar decisão humana e impedir sobrescrita posterior', () => {
    const run = { runId: 'run-1', status: 'rodando', aprovacoes: [] };
    anotarPedido(run, { requestId: 'req-200', runId: 'run-1', comando: 'git pull' });
    
    anotarDecisao(run, { requestId: 'req-200', runId: 'run-1' }, 'sim');
    assert.equal(run.aprovacoes[0].decisao, 'sim');

    // Tentativa de alterar uma decisão já tomada deve ser ignorada
    anotarDecisao(run, { requestId: 'req-200', runId: 'run-1' }, 'nao');
    assert.equal(run.aprovacoes[0].decisao, 'sim');
  });

  it('deve localizar o pedido pendente mais recente em uma demanda ativa', () => {
    const demanda = {
      runs: [
        {
          status: 'rodando',
          aprovacoes: [
            { requestId: 'req-1', decisao: 'sim' },
            { requestId: 'req-2', decisao: null },
          ],
        },
      ],
    };
    const pendente = pedidoPendente(demanda);
    assert.notEqual(pendente, null);
    assert.equal(pendente.pedido.requestId, 'req-2');
  });
});
