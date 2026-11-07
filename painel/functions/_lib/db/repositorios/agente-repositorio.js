/**
 * Flow Automation · Dynamic Agent Repository (ORM)
 * Gerencia persistência, versionamento e sincronização em tempo de execução dos agentes de IA.
 */

import fs from 'node:fs';
import path from 'node:path';

export class AgenteRepository {
  constructor(db) {
    this.db = db;
  }

  listar({ apenasAtivos = false } = {}) {
    const query = apenasAtivos
      ? 'SELECT * FROM agentes WHERE ativo = 1 ORDER BY ordem ASC, nome ASC'
      : 'SELECT * FROM agentes ORDER BY ordem ASC, nome ASC';
    const agentes = this.db.prepare(query).all();

    const stmtSkills = this.db.prepare('SELECT * FROM agente_skills WHERE agente_id = ? AND ativo = 1');
    return agentes.map((agente) => ({
      ...agente,
      ativo: Boolean(agente.ativo),
      skills: stmtSkills.all(agente.id).map((s) => ({ ...s, ativo: Boolean(s.ativo) })),
    }));
  }

  obterPorId(id) {
    if (!id || typeof id !== 'string') return null;
    const agente = this.db.prepare('SELECT * FROM agentes WHERE id = ?').get(id.toLowerCase().trim());
    if (!agente) return null;

    const skills = this.db.prepare('SELECT * FROM agente_skills WHERE agente_id = ?').all(agente.id);
    return {
      ...agente,
      ativo: Boolean(agente.ativo),
      skills: skills.map((s) => ({ ...s, ativo: Boolean(s.ativo) })),
    };
  }

  salvar(dados) {
    const id = String(dados.id || '').toLowerCase().trim();
    if (!/^[a-z0-9_-]{2,50}$/.test(id)) {
      throw new Error(`ID do agente inválido: '${id}'. Use entre 2 e 50 caracteres alfanuméricos minúsculos.`);
    }
    if (!dados.nome || typeof dados.nome !== 'string') {
      throw new Error('O campo "nome" é obrigatório.');
    }
    if (!dados.funcao || typeof dados.funcao !== 'string') {
      throw new Error('O campo "funcao" é obrigatório.');
    }
    if (!dados.soul_prompt || typeof dados.soul_prompt !== 'string') {
      throw new Error('O campo "soul_prompt" é obrigatório.');
    }

    const agora = new Date().toISOString();
    const agenteExistente = this.obterPorId(id);

    const stmtUpsert = this.db.prepare(`
      INSERT INTO agentes (
        id, nome, funcao, icone, descricao, soul_prompt,
        provedor_padrao, modelo_padrao, temperatura, ativo, ordem, distribuicao_yaml, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        nome = excluded.nome,
        funcao = excluded.funcao,
        icone = excluded.icone,
        descricao = excluded.descricao,
        soul_prompt = excluded.soul_prompt,
        provedor_padrao = excluded.provedor_padrao,
        modelo_padrao = excluded.modelo_padrao,
        temperatura = excluded.temperatura,
        ativo = excluded.ativo,
        ordem = excluded.ordem,
        distribuicao_yaml = excluded.distribuicao_yaml,
        atualizado_em = excluded.atualizado_em
    `);

    stmtUpsert.run(
      id,
      dados.nome.trim(),
      dados.funcao.trim(),
      dados.icone || '🤖',
      dados.descricao ? dados.descricao.trim() : null,
      dados.soul_prompt.trim(),
      dados.provedor_padrao || 'openai-api',
      dados.modelo_padrao || 'gpt-4o',
      dados.temperatura ?? 0.7,
      dados.ativo === false ? 0 : 1,
      dados.ordem ?? 0,
      dados.distribuicao_yaml || null,
      agora
    );

    // Salva skills associadas, se fornecidas
    if (Array.isArray(dados.skills)) {
      const stmtSkill = this.db.prepare(`
        INSERT INTO agente_skills (id, agente_id, nome, descricao, instrucoes_md, config_yaml, ativo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          nome = excluded.nome,
          descricao = excluded.descricao,
          instrucoes_md = excluded.instrucoes_md,
          config_yaml = excluded.config_yaml,
          ativo = excluded.ativo
      `);

      for (const skill of dados.skills) {
        if (!skill.nome) continue;
        const skillId = skill.id || `${id}-${skill.nome.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
        stmtSkill.run(
          skillId,
          id,
          skill.nome.trim(),
          skill.descricao ? skill.descricao.trim() : null,
          skill.instrucoes_md || '',
          skill.config_yaml || null,
          skill.ativo === false ? 0 : 1
        );
      }
    }

    // Registro na auditoria
    const tipoAcao = agenteExistente ? 'ATUALIZAR_AGENTE' : 'CRIAR_AGENTE';
    this.db.prepare(`
      INSERT INTO auditoria_logs (tipo, entidade, entidade_id, usuario, detalhes)
      VALUES (?, 'agentes', ?, ?, ?)
    `).run(tipoAcao, id, 'sistema', JSON.stringify({ nome: dados.nome, funcao: dados.funcao }));

    return this.obterPorId(id);
  }

  desativar(id) {
    const agente = this.obterPorId(id);
    if (!agente) return false;

    this.db.prepare('UPDATE agentes SET ativo = 0, atualizado_em = ? WHERE id = ?').run(
      new Date().toISOString(),
      agente.id
    );

    this.db.prepare(`
      INSERT INTO auditoria_logs (tipo, entidade, entidade_id, usuario, detalhes)
      VALUES ('DESATIVAR_AGENTE', 'agentes', ?, 'sistema', 'Agente desativado dinamicamente')
    `).run(agente.id);

    return true;
  }

  excluir(id) {
    const agente = this.obterPorId(id);
    if (!agente) return false;

    this.db.prepare('DELETE FROM agentes WHERE id = ?').run(agente.id);
    this.db.prepare(`
      INSERT INTO auditoria_logs (tipo, entidade, entidade_id, usuario, detalhes)
      VALUES ('EXCLUIR_AGENTE', 'agentes', ?, 'sistema', 'Agente removido fisicamente')
    `).run(agente.id);

    return true;
  }

  sincronizarParaDisco(id, pastaDestino) {
    const agente = this.obterPorId(id);
    if (!agente) throw new Error(`Agente '${id}' não encontrado para sincronização.`);

    const pastaAgente = path.join(pastaDestino, agente.id);
    fs.mkdirSync(pastaAgente, { recursive: true });

    // 1. SOUL.md
    fs.writeFileSync(path.join(pastaAgente, 'SOUL.md'), agente.soul_prompt, 'utf-8');

    // 2. DESCRICAO.txt
    const desc = `${agente.nome}, ${agente.funcao}${agente.descricao ? `: ${agente.descricao}` : '.'}`;
    fs.writeFileSync(path.join(pastaAgente, 'DESCRICAO.txt'), desc, 'utf-8');

    // 3. config.yaml
    const configYaml = [
      `model: "${agente.modelo_padrao || 'gpt-4o'}"`,
      `provider: "${agente.provedor_padrao || 'openai-api'}"`,
      `temperature: ${agente.temperatura ?? 0.7}`,
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(pastaAgente, 'config.yaml'), configYaml, 'utf-8');

    // 4. distribution.yaml
    const distYaml = agente.distribuicao_yaml || [
      `name: ${agente.id}`,
      `version: 1.0.0`,
      `description: "${desc.replace(/"/g, "'")}"`,
      `hermes_requires: ">=0.21.0"`,
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(pastaAgente, 'distribution.yaml'), distYaml, 'utf-8');

    // 5. Skills
    if (agente.skills && agente.skills.length > 0) {
      const pastaSkills = path.join(pastaAgente, 'skills');
      fs.mkdirSync(pastaSkills, { recursive: true });
      for (const skill of agente.skills) {
        const pastaSkill = path.join(pastaSkills, skill.nome);
        fs.mkdirSync(pastaSkill, { recursive: true });
        fs.writeFileSync(path.join(pastaSkill, 'SKILL.md'), skill.instrucoes_md, 'utf-8');
      }
    }

    return pastaAgente;
  }

  sincronizarTodosParaDisco(pastaDestino) {
    const agentes = this.listar({ apenasAtivos: true });
    const sincronizados = [];
    for (const agente of agentes) {
      sincronizados.push(this.sincronizarParaDisco(agente.id, pastaDestino));
    }
    return sincronizados;
  }

  importarDoDisco(pastaAgentes) {
    if (!fs.existsSync(pastaAgentes)) return 0;
    const entradas = fs.readdirSync(pastaAgentes, { withFileTypes: true });
    let totalImportados = 0;

    for (const entrada of entradas) {
      if (!entrada.isDirectory()) continue;
      const agenteId = entrada.name.toLowerCase();
      const pastaAgente = path.join(pastaAgentes, entrada.name);
      const soulPath = path.join(pastaAgente, 'SOUL.md');
      if (!fs.existsSync(soulPath)) continue;

      const soulPrompt = fs.readFileSync(soulPath, 'utf-8');
      const descPath = path.join(pastaAgente, 'DESCRICAO.txt');
      let descricaoTexto = '';
      if (fs.existsSync(descPath)) {
        descricaoTexto = fs.readFileSync(descPath, 'utf-8').trim();
      }

      const nomeCapitalizado = agenteId.charAt(0).toUpperCase() + agenteId.slice(1);
      const funcaoPadrao = descricaoTexto.includes(':') ? descricaoTexto.split(':')[0].trim() : 'Especialista de IA';

      // Importar skills
      const skills = [];
      const pastaSkills = path.join(pastaAgente, 'skills');
      if (fs.existsSync(pastaSkills)) {
        const skillsDirs = fs.readdirSync(pastaSkills, { withFileTypes: true });
        for (const sd of skillsDirs) {
          if (!sd.isDirectory()) continue;
          const skillMd = path.join(pastaSkills, sd.name, 'SKILL.md');
          if (fs.existsSync(skillMd)) {
            skills.push({
              nome: sd.name,
              descricao: `Habilidade ${sd.name} do agente ${nomeCapitalizado}`,
              instrucoes_md: fs.readFileSync(skillMd, 'utf-8'),
              ativo: true,
            });
          }
        }
      }

      this.salvar({
        id: agenteId,
        nome: nomeCapitalizado,
        funcao: funcaoPadrao,
        icone: agenteId === 'frank' ? '👑' : '🤖',
        descricao: descricaoTexto,
        soul_prompt: soulPrompt,
        provedor_padrao: 'openai-api',
        modelo_padrao: 'gpt-4o',
        ativo: true,
        skills,
      });

      totalImportados++;
    }

    return totalImportados;
  }
}

