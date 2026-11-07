import { ErroHttp, lerCorpoJson, responderJson, tratarErros } from '../../../_lib/http.js';
import { obterServicoBanco } from '../../../_lib/db/servico.js';
import path from 'node:path';
import os from 'node:os';

export function onRequestGet({ params, env }) {
  return tratarErros(async () => {
    const { id } = params;
    const servico = obterServicoBanco(env);
    const agente = servico.agentes.obterPorId(id);

    if (!agente) {
      throw new ErroHttp(404, `Agente "${id}" não encontrado.`);
    }

    return responderJson(200, { agente });
  });
}

export function onRequestPut({ params, request, env }) {
  return tratarErros(async () => {
    const { id } = params;
    const corpo = await lerCorpoJson(request);
    const servico = obterServicoBanco(env);

    const existente = servico.agentes.obterPorId(id);
    if (!existente) {
      throw new ErroHttp(404, `Agente "${id}" não encontrado para atualização.`);
    }

    let agenteAtualizado;
    try {
      agenteAtualizado = servico.agentes.salvar({ ...corpo, id });
    } catch (err) {
      throw new ErroHttp(400, err.message);
    }

    // Sincroniza atualização para a pasta de perfis
    const localAppData = env?.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const pastaPerfis = path.join(localAppData, 'hermes', 'profiles');
    try {
      servico.agentes.sincronizarParaDisco(id, pastaPerfis);
    } catch (syncErr) {
      console.warn(`[frank/agentes] Aviso ao sincronizar em ${pastaPerfis}: ${syncErr.message}`);
    }

    return responderJson(200, {
      mensagem: `Agente @${id} atualizado dinamicamente com sucesso.`,
      agente: agenteAtualizado,
    });
  });
}

export function onRequestDelete({ params, env }) {
  return tratarErros(async () => {
    const { id } = params;
    const servico = obterServicoBanco(env);

    const desativado = servico.agentes.desativar(id);
    if (!desativado) {
      throw new ErroHttp(404, `Agente "${id}" não encontrado.`);
    }

    return responderJson(200, {
      mensagem: `Agente @${id} desativado dinamicamente com sucesso.`,
      id,
      ativo: false,
    });
  });
}
