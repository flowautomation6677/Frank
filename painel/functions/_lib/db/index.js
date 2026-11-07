/**
 * Flow Automation · Database Connection Manager
 * Gerenciamento centralizado de conexões SQLite com suporte a WAL mode e chaves estrangeiras.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let instanciaBanco = null;
let caminhoBancoAtual = null;

export function resolverCaminhoPadraoBanco(env = process.env) {
  if (env.FRANK_DATABASE_PATH) {
    return env.FRANK_DATABASE_PATH;
  }

  if (env.FRANK_PASTA_DE_DADOS) {
    return path.join(env.FRANK_PASTA_DE_DADOS, 'frank.db');
  }

  const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const pastaDados = path.join(localAppData, 'TimeDoFrank', 'dados');
  return path.join(pastaDados, 'frank.db');
}

export function obterBanco(caminho = null, { forcarNovo = false } = {}) {
  const caminhoResolvido = caminho || resolverCaminhoPadraoBanco();

  if (instanciaBanco && caminhoBancoAtual === caminhoResolvido && !forcarNovo) {
    return instanciaBanco;
  }

  if (instanciaBanco && forcarNovo) {
    fecharBanco();
  }

  if (caminhoResolvido !== ':memory:') {
    const pastaPai = path.dirname(caminhoResolvido);
    if (!fs.existsSync(pastaPai)) {
      fs.mkdirSync(pastaPai, { recursive: true });
    }
  }

  const db = new DatabaseSync(caminhoResolvido);

  db.exec('PRAGMA foreign_keys = ON;');
  if (caminhoResolvido !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL;');
    } catch {}
  }

  instanciaBanco = db;
  caminhoBancoAtual = caminhoResolvido;
  return db;
}

export function fecharBanco() {
  if (instanciaBanco) {
    try {
      instanciaBanco.close();
    } catch {}
    instanciaBanco = null;
    caminhoBancoAtual = null;
  }
}

