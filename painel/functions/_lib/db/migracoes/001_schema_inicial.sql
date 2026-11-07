-- ==============================================================================
-- Flow Automation · Migração 001: Schema Inicial Enterprise
-- ==============================================================================

CREATE TABLE IF NOT EXISTS _migracoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  versao TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  checksum TEXT NOT NULL,
  executado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de Agentes de IA Dinâmicos
CREATE TABLE IF NOT EXISTS agentes (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  funcao TEXT NOT NULL,
  icone TEXT DEFAULT '🤖',
  descricao TEXT,
  soul_prompt TEXT NOT NULL,
  provedor_padrao TEXT DEFAULT 'openai-api',
  modelo_padrao TEXT DEFAULT 'gpt-4o',
  temperatura REAL DEFAULT 0.7,
  ativo INTEGER DEFAULT 1,
  ordem INTEGER DEFAULT 0,
  distribuicao_yaml TEXT,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agentes_ativo ON agentes(ativo);
CREATE INDEX IF NOT EXISTS idx_agentes_ordem ON agentes(ordem);

-- Tabela de Habilidades (Skills) dos Agentes
CREATE TABLE IF NOT EXISTS agente_skills (
  id TEXT PRIMARY KEY,
  agente_id TEXT NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT,
  instrucoes_md TEXT NOT NULL,
  config_yaml TEXT,
  ativo INTEGER DEFAULT 1,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_skills_agente ON agente_skills(agente_id);

-- Tabela Centralizada de Conhecimento Empresarial (Onboarding)
CREATE TABLE IF NOT EXISTS conhecimento_empresa (
  id TEXT PRIMARY KEY,
  bloco_numero INTEGER NOT NULL,
  bloco_nome TEXT NOT NULL,
  arquivo_referencia TEXT NOT NULL,
  secao TEXT NOT NULL,
  chave TEXT NOT NULL,
  valor TEXT NOT NULL,
  pendente INTEGER DEFAULT 1,
  atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conhecimento_bloco ON conhecimento_empresa(bloco_numero);
CREATE INDEX IF NOT EXISTS idx_conhecimento_pendente ON conhecimento_empresa(pendente);

-- Tabela de Demandas e Turnos
CREATE TABLE IF NOT EXISTS demandas (
  id TEXT PRIMARY KEY,
  dono_id TEXT NOT NULL,
  titulo TEXT NOT NULL,
  status TEXT DEFAULT 'ativa',
  resumo TEXT,
  historico_json TEXT,
  entregas_json TEXT,
  decisoes_json TEXT,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_demandas_dono ON demandas(dono_id);
CREATE INDEX IF NOT EXISTS idx_demandas_status ON demandas(status);

-- Tabela de Auditoria e Rastreabilidade
CREATE TABLE IF NOT EXISTS auditoria_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  entidade TEXT NOT NULL,
  entidade_id TEXT,
  usuario TEXT,
  detalhes TEXT,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auditoria_tipo ON auditoria_logs(tipo);
