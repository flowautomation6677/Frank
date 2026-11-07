/**
 * Flow Automation · Knowledge Base Repository (ORM)
 * Centraliza o onboarding empresarial e base de dados em tabelas relacionais com controle de versão.
 */

import fs from 'node:fs';
import path from 'node:path';

export const BLOCOS_DEFINICAO = [
  { numero: 1, nome: '1. Dados básicos', arquivos: ['empresa.md'] },
  { numero: 2, nome: '2. Oferta', arquivos: ['produtos-e-precos.md', 'oferta-atual.md'] },
  { numero: 3, nome: '3. Cliente ideal', arquivos: ['publico-e-dores.md', 'perguntas-frequentes.md'] },
  { numero: 4, nome: '4. Marca, tom de voz e promessas', arquivos: ['voz-da-marca.md', 'provas-e-depoimentos.md'] },
  { numero: 5, nome: '5. Canais', arquivos: ['canais-e-integracoes.md'] },
  { numero: 6, nome: '6. Regras do time', arquivos: ['regras-da-casa.md'] },
  { numero: 7, nome: '7. Metas e momento', arquivos: ['empresa.md', 'oferta-atual.md'] },
  { numero: 8, nome: '8. Concorrentes e referências', arquivos: ['empresa.md'] },
];

export class ConhecimentoRepository {
  constructor(db) {
    this.db = db;
  }

  obterSituacao() {
    const totalGeral = this.db.prepare('SELECT COUNT(*) as total FROM conhecimento_empresa').get()?.total || 0;
    if (totalGeral === 0) {
      return { existe: false, totalItens: 0, itensPendentes: 0, blocos: [] };
    }

    const query = `
      SELECT 
        bloco_numero,
        bloco_nome,
        COUNT(*) as total_itens,
        SUM(CASE WHEN pendente = 1 THEN 1 ELSE 0 END) as pendentes
      FROM conhecimento_empresa
      GROUP BY bloco_numero, bloco_nome
      ORDER BY bloco_numero ASC
    `;
    const linhas = this.db.prepare(query).all();

    const pendentesTotais = linhas.reduce((acc, row) => acc + Number(row.pendentes), 0);

    return {
      existe: true,
      totalItens: totalGeral,
      itensPendentes: pendentesTotais,
      blocos: linhas.map((row) => ({
        numero: row.bloco_numero,
        nome: row.bloco_nome,
        totalItens: Number(row.total_itens),
        pendentes: Number(row.pendentes),
      })),
    };
  }

  listarPorBloco(blocoNumero) {
    return this.db
      .prepare('SELECT * FROM conhecimento_empresa WHERE bloco_numero = ? ORDER BY secao ASC, chave ASC')
      .all(blocoNumero)
      .map((item) => ({ ...item, pendente: Boolean(item.pendente) }));
  }

  salvarItem(dados) {
    const id = dados.id || `${dados.arquivo_referencia}:${dados.chave}`.toLowerCase().replace(/[^a-z0-9_.:-]/g, '-');
    const agora = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO conhecimento_empresa (
        id, bloco_numero, bloco_nome, arquivo_referencia, secao, chave, valor, pendente, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        valor = excluded.valor,
        pendente = excluded.pendente,
        atualizado_em = excluded.atualizado_em
    `);

    stmt.run(
      id,
      dados.bloco_numero,
      dados.bloco_nome,
      dados.arquivo_referencia,
      dados.secao || 'Geral',
      dados.chave,
      dados.valor || '',
      dados.pendente === false ? 0 : 1,
      agora
    );

    return this.obterItemPorId(id);
  }

  obterItemPorId(id) {
    if (!id || typeof id !== 'string') return null;
    const normalizado = id.toLowerCase().replace(/[^a-z0-9_.:-]/g, '-');
    const item = this.db.prepare(`
      SELECT * FROM conhecimento_empresa 
      WHERE id = ? OR id = ? OR chave = ? COLLATE NOCASE
      LIMIT 1
    `).get(id, normalizado, id);
    return item ? { ...item, pendente: Boolean(item.pendente) } : null;
  }

  atualizarValor(id, valor, pendente = false) {
    const item = this.obterItemPorId(id);
    if (!item) return null;

    this.db.prepare(`
      UPDATE conhecimento_empresa
      SET valor = ?, pendente = ?, atualizado_em = ?
      WHERE id = ?
    `).run(valor, pendente ? 1 : 0, new Date().toISOString(), item.id);

    this.db.prepare(`
      INSERT INTO auditoria_logs (tipo, entidade, entidade_id, usuario, detalhes)
      VALUES ('ATUALIZAR_CONHECIMENTO', 'conhecimento_empresa', ?, 'sistema', ?)
    `).run(item.id, JSON.stringify({ chave: item.chave, novoValor: valor }));

    return this.obterItemPorId(item.id);
  }

  importarDeMarkdown(pastaOrigem) {
    if (!fs.existsSync(pastaOrigem)) return 0;
    const arquivos = fs.readdirSync(pastaOrigem).filter((f) => f.endsWith('.md'));
    let totalImportados = 0;

    for (const arq of arquivos) {
      const conteudo = fs.readFileSync(path.join(pastaOrigem, arq), 'utf-8');
      const linhas = conteudo.split(/\r?\n/);

      let secaoAtual = 'Geral';
      const blocoDef = BLOCOS_DEFINICAO.find((b) => b.arquivos.includes(arq)) || {
        numero: 9,
        nome: 'Outros',
      };

      for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i].trim();
        if (linha.startsWith('#')) {
          secaoAtual = linha.replace(/^#+\s*/, '').trim();
          continue;
        }

        const linhaSemMarcador = linha.replace(/^[-*]\s*/, '').trim();
        const matchChaveValor = linhaSemMarcador.match(/^([A-Za-z0-9_À-ÿ\s-]+):\s*(.*)$/);
        if (matchChaveValor) {
          const chave = matchChaveValor[1].trim();
          const valor = matchChaveValor[2].trim();
          const pendente = valor.includes('a definir pelo dono') || valor.includes('{{') || valor === '';

          this.salvarItem({
            id: `${arq}:${chave}`.toLowerCase().replace(/[^a-z0-9_.:-]/g, '-'),
            bloco_numero: blocoDef.numero,
            bloco_nome: blocoDef.nome,
            arquivo_referencia: arq,
            secao: secaoAtual,
            chave,
            valor,
            pendente,
          });
          totalImportados++;
        }
      }
    }

    return totalImportados;
  }

  exportarParaMarkdown(pastaDestino) {
    fs.mkdirSync(pastaDestino, { recursive: true });
    const todos = this.db.prepare('SELECT * FROM conhecimento_empresa ORDER BY bloco_numero, secao, chave').all();

    const arquivosAgrupados = new Map();
    for (const item of todos) {
      if (!arquivosAgrupados.has(item.arquivo_referencia)) {
        arquivosAgrupados.set(item.arquivo_referencia, []);
      }
      arquivosAgrupados.get(item.arquivo_referencia).push(item);
    }

    const exportados = [];
    for (const [arquivo, itens] of arquivosAgrupados) {
      const linhas = [`# Base de Conhecimento · ${arquivo.replace(/\.md$/, '').toUpperCase()}\n`];
      let secaoAnterior = null;

      for (const item of itens) {
        if (item.secao !== secaoAnterior) {
          linhas.push(`\n## ${item.secao}\n`);
          secaoAnterior = item.secao;
        }
        linhas.push(`${item.chave}: ${item.valor}`);
      }

      const destino = path.join(pastaDestino, arquivo);
      fs.writeFileSync(destino, linhas.join('\n') + '\n', 'utf-8');
      exportados.push(destino);
    }

    return exportados;
  }
}
