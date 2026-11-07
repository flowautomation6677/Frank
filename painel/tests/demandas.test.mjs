import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  novaDemanda,
  novoIdDeDemanda,
  tituloDoPedido,
} from '../functions/_lib/demandas.js';

describe('Módulo de Gestão de Demandas & Validação de Identidade', () => {
  it('deve gerar IDs de demanda com prefixo d- e formato seguro contra injeção', () => {
    const id = novoIdDeDemanda();
    assert.match(id, /^d-[a-z0-9-]{6,60}$/);
    assert.equal(id.includes('..'), false);
    assert.equal(id.includes('/'), false);
    assert.equal(id.includes('\\'), false);
  });

  it('deve extrair e formatar títulos de pedidos corretamente', () => {
    const titulo = tituloDoPedido('Pede para a Renata 3 anúncios');
    assert.ok(typeof titulo === 'string');
    assert.ok(titulo.length > 0);
  });

  it('deve inicializar nova demanda com propriedades corretas e resumo', () => {
    const demanda = novaDemanda({
      titulo: 'Campanha de Tráfego Black Friday',
      saudacao: 'Olá Frank',
      nome: 'Luiz Antonio',
    });
    assert.equal(demanda.titulo, 'Campanha de Tráfego Black Friday');
    assert.equal(demanda.nome, 'Luiz Antonio');
    assert.ok(Array.isArray(demanda.runs));
    assert.ok(Array.isArray(demanda.entregas));
    assert.match(demanda.criadaEm, /^\d{4}-\d{2}-\d{2}T/);
  });
});
