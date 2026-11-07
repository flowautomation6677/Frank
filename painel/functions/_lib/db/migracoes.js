/**
 * Flow Automation · Schema Migration Engine
 * Gerencia migrações SQL versionadas de forma atômica e rastreável.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PASTA_MIGRACOES = path.join(__dirname, 'migracoes');

function calcularChecksum(conteudo) {
  return crypto.createHash('sha256').update(conteudo.trim(), 'utf-8').digest('hex');
}

export function garantirTabelaMigracoes(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      versao TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      checksum TEXT NOT NULL,
      executado_em TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function listarMigracoesDisponiveis(pasta = PASTA_MIGRACOES) {
  if (!fs.existsSync(pasta)) return [];

  const arquivos = fs.readdirSync(pasta).filter((f) => f.endsWith('.sql'));
  arquivos.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return arquivos.map((arquivo) => {
    const caminho = path.join(pasta, arquivo);
    const conteudo = fs.readFileSync(caminho, 'utf-8');
    const versao = arquivo.split('_')[0];
    const nome = arquivo.replace(/\.sql$/, '');
    const checksum = calcularChecksum(conteudo);

    return { versao, nome, arquivo, caminho, conteudo, checksum };
  });
}

export function statusMigracoes(db, pasta = PASTA_MIGRACOES) {
  garantirTabelaMigracoes(db);
  const aplicadasDb = db.prepare('SELECT versao, nome, checksum, executado_em FROM _migracoes ORDER BY id ASC').all();
  const mapaAplicadas = new Map(aplicadasDb.map((m) => [m.versao, m]));

  const disponiveis = listarMigracoesDisponiveis(pasta);
  const aplicadas = [];
  const pendentes = [];

  for (const disp of disponiveis) {
    if (mapaAplicadas.has(disp.versao)) {
      aplicadas.push({ ...disp, executado_em: mapaAplicadas.get(disp.versao).executado_em });
    } else {
      pendentes.push(disp);
    }
  }

  return { aplicadas, pendentes, totalDisponiveis: disponiveis.length };
}

export function executarMigracoes(db, pasta = PASTA_MIGRACOES) {
  garantirTabelaMigracoes(db);
  const status = statusMigracoes(db, pasta);
  const executadas = [];

  if (status.pendentes.length === 0) {
    return { executadas, total: status.aplicadas.length };
  }

  const stmtInsert = db.prepare(`
    INSERT INTO _migracoes (versao, nome, checksum)
    VALUES (?, ?, ?)
  `);

  for (const pendente of status.pendentes) {
    db.exec('BEGIN TRANSACTION;');
    try {
      db.exec(pendente.conteudo);
      stmtInsert.run(pendente.versao, pendente.nome, pendente.checksum);
      db.exec('COMMIT;');
      executadas.push(pendente);
    } catch (erro) {
      db.exec('ROLLBACK;');
      throw new Error(`Falha ao executar migração ${pendente.nome}: ${erro.message}`);
    }
  }

  return { executadas, total: status.aplicadas.length + executadas.length };
}

