import { ErroHttp, lerCorpoJson, responderJson, tratarErros } from '../../_lib/http.js';
import { obterServicoBanco } from '../../_lib/db/servico.js';
import path from 'node:path';
import os from 'node:os';

export function onRequestGet({ request, env }) {
  return tratarErros(async () => {
    const url = new URL(request.url);
    const apenasAtivos = url.searchParams.get('ativos') !== 'false';
    const servico = obterServicoBanco(env);
    const agentes = servico.agentes.listar({ apenasAtivos });
    return responderJson(200, { agentes, total: agentes.length });
  });
}

export function onRequestPost({ request, env }) {
  return tratarErros(async () => {
    const corpo = await lerCorpoJson(request);
    const servico = obterServicoBanco(env);

    let agenteSalvo;
    try {
      agenteSalvo = servico.agentes.salvar(corpo);
    } catch (err) {
      throw new ErroHttp(400, err.message);
    }

    // Sincroniza dinamicamente para a pasta de perfis do Hermes e agentes físicos
    const localAppData = env?.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const pastaPerfis = path.join(localAppData, 'hermes', 'profiles');
    try {
      servico.agentes.sincronizarParaDisco(agenteSalvo.id, pastaPerfis);
    } catch (syncErr) {
      console.warn(`[frank/agentes] Aviso ao sincronizar em ${pastaPerfis}: ${syncErr.message}`);
    }

    return responderJson(201, {
      mensagem: `Agente @${agenteSalvo.id} criado e registrado com sucesso.`,
      agente: agenteSalvo,
    });
  });
}
