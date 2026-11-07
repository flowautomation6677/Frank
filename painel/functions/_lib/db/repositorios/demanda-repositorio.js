/**
 * Flow Automation · Demand Repository (ORM)
 * Gerencia persistência de demandas e turnos com proteção nativa contra IDOR/BOLA.
 */

export class DemandaRepository {
  constructor(db) {
    this.db = db;
  }

  listarPorDono(donoId) {
    if (!donoId) return [];
    return this.db
      .prepare('SELECT * FROM demandas WHERE dono_id = ? ORDER BY atualizado_em DESC')
      .all(donoId)
      .map(this._deserializar);
  }

  obterPorId(id, donoId = null) {
    if (!id) return null;
    let query = 'SELECT * FROM demandas WHERE id = ?';
    const params = [id];

    if (donoId) {
      query += ' AND dono_id = ?';
      params.push(donoId);
    }

    const row = this.db.prepare(query).get(...params);
    return row ? this._deserializar(row) : null;
  }

  salvar(demanda) {
    if (!demanda.id || !demanda.dono_id || !demanda.titulo) {
      throw new Error('Demanda requer id, dono_id e titulo.');
    }

    const agora = new Date().toISOString();
    const historicoJson = JSON.stringify(demanda.historico || []);
    const entregasJson = JSON.stringify(demanda.entregas || []);
    const decisoesJson = JSON.stringify(demanda.decisoes || {});

    const stmt = this.db.prepare(`
      INSERT INTO demandas (
        id, dono_id, titulo, status, resumo, historico_json, entregas_json, decisoes_json, criado_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        titulo = excluded.titulo,
        status = excluded.status,
        resumo = excluded.resumo,
        historico_json = excluded.historico_json,
        entregas_json = excluded.entregas_json,
        decisoes_json = excluded.decisoes_json,
        atualizado_em = excluded.atualizado_em
    `);

    stmt.run(
      demanda.id,
      demanda.dono_id,
      demanda.titulo,
      demanda.status || 'ativa',
      demanda.resumo || null,
      historicoJson,
      entregasJson,
      decisoesJson,
      demanda.criado_em || agora,
      agora
    );

    return this.obterPorId(demanda.id, demanda.dono_id);
  }

  excluir(id, donoId) {
    const demanda = this.obterPorId(id, donoId);
    if (!demanda) return false;

    this.db.prepare('DELETE FROM demandas WHERE id = ? AND dono_id = ?').run(id, donoId);
    return true;
  }

  _deserializar(row) {
    return {
      id: row.id,
      donoId: row.dono_id,
      titulo: row.titulo,
      status: row.status,
      resumo: row.resumo,
      historico: row.historico_json ? JSON.parse(row.historico_json) : [],
      entregas: row.entregas_json ? JSON.parse(row.entregas_json) : [],
      decisoes: row.decisoes_json ? JSON.parse(row.decisoes_json) : {},
      criadoEm: row.criado_em,
      atualizadoEm: row.atualizado_em,
    };
  }
}
