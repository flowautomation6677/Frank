/**
 * Flow Automation · Central Database & ORM Service
 * Inicializa a conexão, executa migrações pendentes e provê acesso aos repositórios.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fecharBanco, obterBanco, resolverCaminhoPadraoBanco } from './index.js';
import { executarMigracoes } from './migracoes.js';
import { AgenteRepository } from './repositorios/agente-repositorio.js';
import { ConhecimentoRepository } from './repositorios/conhecimento-repositorio.js';
import { DemandaRepository } from './repositorios/demanda-repositorio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAIZ_DO_PROJETO = path.resolve(__dirname, '..', '..', '..', '..');

let servicoCache = null;

export function obterServicoBanco(env = process.env, { forcarNovo = false } = {}) {
  if (servicoCache && !forcarNovo) {
    return servicoCache;
  }

  const caminhoBanco = resolverCaminhoPadraoBanco(env);
  const db = obterBanco(caminhoBanco, { forcarNovo });

  // Executa migrações estruturais
  executarMigracoes(db);

  const agentes = new AgenteRepository(db);
  const conhecimento = new ConhecimentoRepository(db);
  const demandas = new DemandaRepository(db);

  // Auto-seed inicial de agentes caso a base esteja vazia
  const listaAgentes = agentes.listar();
  if (listaAgentes.length === 0) {
    const pastaAgentesFisicos = path.join(RAIZ_DO_PROJETO, 'agentes');
    if (fs.existsSync(pastaAgentesFisicos)) {
      agentes.importarDoDisco(pastaAgentesFisicos);
    }
  }

  // Auto-seed de conhecimento se vazio
  const situacaoConhecimento = conhecimento.obterSituacao();
  if (!situacaoConhecimento.existe || situacaoConhecimento.totalItens === 0) {
    const pastaModelo = path.join(
      RAIZ_DO_PROJETO,
      'agentes',
      'frank',
      'skills',
      'onboarding-da-empresa',
      'references',
      'modelo'
    );
    if (fs.existsSync(pastaModelo)) {
      conhecimento.importarDeMarkdown(pastaModelo);
    }
  }

  servicoCache = { db, agentes, conhecimento, demandas };
  return servicoCache;
}

export function fecharServicoBanco() {
  fecharBanco();
  servicoCache = null;
}
