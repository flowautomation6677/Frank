// Lógica pura do painel ligado ao Hermes: eventos do turno, quadro do time, bandeja, textos e cérebro.
// Sem DOM: roda no navegador e nos testes do Node.
import { AGENTES, nomeDoAgente } from './time.js';

const IDS_DO_TIME = new Set(AGENTES.map((agente) => agente.id));
const FEMININOS = new Set(['isabela', 'renata', 'marina', 'lara']);
const PREFIXO_DO_AGENTE = /^\s*\[([^\]]+)\]\s*/;
// O filho "[Revisão]" confere a entrega antes de ela chegar ao dono: não é assistente do time.
export const FERRAMENTA_DE_REVISAO = 'revisao';
// delegate_task já aparece como agente_inicio e agente_fim; o empurrão é interno da ponte (a trava anti-promessa).
const FERRAMENTAS_SEM_REGISTRO = new Set(['delegate_task', 'empurrao']);
// Ferramenta de MCP chega como "mcp__<servidor>__<ferramenta>" (tools/mcp_tool_schema.py do Hermes).
const PREFIXO_DE_MCP = /^mcp__.+?__(.+)$/;
const LIMITE_DO_RESUMO = 160;
const LIMITE_DO_ARQUIVO = 300;
const LIMITE_DA_TAREFA_NO_PENSAMENTO = 90;
const LIMITE_DO_TITULO_NO_AVISO = 90;
const LIMITE_DO_COMANDO_NA_FALA = 160;
const LIMITE_DO_COMANDO_NO_REGISTRO = 120;
const DECISOES_DA_AUTORIZACAO = new Set(['sim', 'nao', 'expirou']);
const DIA_EM_MS = 86_400_000;
export const TEXTO_SEM_RESPOSTA = 'Sem resposta, o comando não rodou.';
// Teto final do turno: 2 horas.
// Um turno pode somar 30 minutos de assistente e 5 de espera de autorização; conexão caída quem pega é a vigia de
// silêncio, com 90 s sem byte nenhum, contando o keepalive que a ponte manda a cada 20 s.
export const DURACAO_MAXIMA_DO_TURNO_MS = 2 * 60 * 60_000;
export const SILENCIO_MAXIMO_DO_STREAM_MS = 90_000;
const RELOGIO_REAL = { agendar: (tarefa, ms) => setTimeout(tarefa, ms), cancelar: (id) => clearTimeout(id) };

const VERBOS = {
  ulisses: 'tá pensando na estratégia',
  isabela: 'tá olhando os números',
  renata: 'tá escrevendo',
  marina: 'tá montando a página',
  lara: 'tá criando o conteúdo',
  breno: 'tá cuidando dos anúncios',
  vitor: 'tá falando com os interessados',
};

const ROTULOS_DE_ESFORCO = { baixo: 'baixo', medio: 'médio', alto: 'alto' };
// Provedores de assinatura pelo id do Hermes: só os que entram pelo login na conta do plano.
// Ficam fora o "ollama-cloud" (chave de API, cobrança por token além dos créditos do plano) e o
// "anthropic" (aceita chave de API ou token OAuth do Claude Code, e a lista não diz qual está conectado).
const NOMES_DOS_PROVEDORES = {
  'openai-codex': 'Assinatura ChatGPT/Codex',
  'claude-subscription-directsdk-experimental': 'Assinatura Claude',
  'xai-oauth': 'Assinatura Grok',
  copilot: 'Assinatura GitHub Copilot',
};
const NUMERO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const DIA_E_MES = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });

const texto = (valor) => (typeof valor === 'string' ? valor : '');
const numeroOuNulo = (valor) => (typeof valor === 'number' && Number.isFinite(valor) ? valor : null);
const espacosSimples = (valor) => texto(valor).replace(/\s+/g, ' ').trim();
const semPontoFinal = (valor) => espacosSimples(valor).replace(/[.\s]+$/u, '').trim();

function cortarFrase(valor, limite) {
  const limpo = espacosSimples(valor);
  return limpo.length > limite ? `${limpo.slice(0, limite - 1).trimEnd()}…` : limpo;
}

const semAcento = (nome) => texto(nome).normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

function idDoNome(nome) {
  const id = semAcento(nome);
  return IDS_DO_TIME.has(id) ? id : null;
}

function eRevisao(valor) {
  const prefixo = PREFIXO_DO_AGENTE.exec(texto(valor));
  return Boolean(prefixo) && semAcento(prefixo[1]) === FERRAMENTA_DE_REVISAO;
}

// Nome falado do autor: os 7 do time pelo nome; sem agente (trabalho do próprio Frank), "Frank".
export function nomeDe(agente) {
  return agente ? nomeDoAgente(agente) : 'Frank';
}

function artigo(agente) {
  return agente && FEMININOS.has(agente) ? 'a' : 'o';
}

// "[Renata] Criar 3 headlines" → { agente: 'renata', tarefa: 'Criar 3 headlines' }. Nome fora do time → agente null.
export function extrairAgente(valor) {
  const bruto = texto(valor);
  const prefixo = PREFIXO_DO_AGENTE.exec(bruto);
  if (!prefixo) return { agente: null, tarefa: bruto.trim() };
  return { agente: idDoNome(prefixo[1]), tarefa: bruto.slice(prefixo[0].length).trim() };
}

function agenteDoEvento(bruto) {
  const tarefa = texto(bruto.tarefa).trim();
  const extraido = extrairAgente(tarefa);
  return { agente: idDoNome(bruto.agente) ?? extraido.agente, tarefa: extraido.tarefa };
}

// Evento do SSE do servidor (normalizarEvento de functions/_lib/hermes.js) → evento conferido, ou null quando não serve ao painel.
export function normalizarEvento(bruto) {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  switch (bruto.tipo) {
    case 'inicio':
      return { tipo: 'inicio', runId: texto(bruto.runId), demandaId: texto(bruto.demandaId) || null };
    case 'ferramenta': {
      const resumo = texto(bruto.resumo).slice(0, LIMITE_DO_RESUMO);
      return { tipo: 'ferramenta', nome: texto(bruto.nome).trim(), fase: bruto.fase === 'fim' ? 'fim' : 'inicio', ...(resumo ? { resumo } : {}) };
    }
    case 'agente_inicio': {
      const { agente, tarefa } = agenteDoEvento(bruto);
      if (eRevisao(bruto.tarefa)) return { tipo: 'ferramenta', nome: FERRAMENTA_DE_REVISAO, fase: 'inicio', ...(tarefa ? { resumo: tarefa.slice(0, LIMITE_DO_RESUMO) } : {}) };
      return { tipo: 'agente_inicio', agente, tarefa, subagenteId: texto(bruto.subagenteId) };
    }
    case 'agente_fim': {
      const entrega = bruto.entrega && typeof bruto.entrega === 'object' ? bruto.entrega : {};
      if (eRevisao(entrega.titulo)) return { tipo: 'ferramenta', nome: FERRAMENTA_DE_REVISAO, fase: 'fim' };
      const corpo = texto(entrega.texto).trim();
      const titulo = extrairAgente(espacosSimples(entrega.titulo)).tarefa || 'Entrega sem título';
      const arquivo = espacosSimples(entrega.arquivo).slice(0, LIMITE_DO_ARQUIVO);
      return {
        tipo: 'agente_fim',
        agente: agenteDoEvento(bruto).agente,
        subagenteId: texto(bruto.subagenteId),
        // Entrega vazia não tem o que aprovar: conta como falha do assistente.
        status: bruto.status !== 'erro' && corpo ? 'ok' : 'erro',
        entrega: {
          titulo,
          texto: corpo,
          ...(arquivo ? { arquivo } : {}),
          ...(typeof entrega.tipo === 'string' ? { tipo: entrega.tipo } : {}),
          ...(Array.isArray(entrega.pendencias) ? { pendencias: entrega.pendencias.filter((item) => typeof item === 'string') } : {}),
        },
        duracaoS: numeroOuNulo(bruto.duracaoS),
      };
    }
    case 'aprovacao':
      // O comando fica inteiro, sem corte: quem autoriza precisa ver tudo o que vai rodar.
      return { tipo: 'aprovacao', comando: texto(bruto.comando).trim(), descricao: espacosSimples(bruto.descricao), ...(bruto.requestId ? { requestId: texto(bruto.requestId) } : {}) };
    case 'aprovacao_fim':
      return { tipo: 'aprovacao_fim', decisao: DECISOES_DA_AUTORIZACAO.has(bruto.decisao) ? bruto.decisao : null, ...(bruto.requestId ? { requestId: texto(bruto.requestId) } : {}) };
    case 'texto':
      return typeof bruto.delta === 'string' ? { tipo: 'texto', delta: bruto.delta } : null;
    case 'andamento': {
      const fala = espacosSimples(bruto.texto);
      return fala ? { tipo: 'andamento', texto: fala } : null;
    }
    case 'fim':
      return {
        tipo: 'fim',
        fala: texto(bruto.fala).trim(),
        provedor: texto(bruto.provedor) || null,
        modelo: texto(bruto.modelo) || null,
        duracaoS: numeroOuNulo(bruto.duracaoS),
      };
    case 'erro':
      return { tipo: 'erro', mensagem: texto(bruto.mensagem).trim() || 'O Hermes travou no meio do turno.' };
    default:
      return null;
  }
}

function hashCurto(valor) {
  let hash = 0x811c9dc5;
  for (const caractere of valor) {
    hash ^= caractere.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

// Mesma chave para a entrega que chega pelo stream e para a que volta do arquivo da demanda.
export function chaveDaEntrega(agente, corpo) {
  return `e-${agente ?? 'frank'}-${hashCurto(espacosSimples(corpo))}`;
}

export function pendentesDaDemanda(demanda) {
  const entregas = Array.isArray(demanda?.entregas) ? demanda.entregas : [];
  return entregas
    .filter((entrega) => entrega?.status === 'pendente' && texto(entrega.texto).trim())
    .map((entrega) => {
      const agente = idDoNome(entrega.agente);
      return {
        chave: chaveDaEntrega(agente, entrega.texto),
        id: texto(entrega.id) || null,
        agente,
        titulo: espacosSimples(entrega.titulo) || 'Entrega sem título',
        entrega: texto(entrega.texto).trim(),
        arquivo: espacosSimples(entrega.arquivo).slice(0, LIMITE_DO_ARQUIVO) || null,
        criadaEm: texto(entrega.criadaEm) || null,
        duracaoS: null,
        runId: null,
      };
    });
}

export function formatarSegundos(segundos) {
  return `${NUMERO.format(segundos)} s`;
}

export function textoDoFim(fim) {
  const duracao = fim.duracaoS === null ? '' : ` em ${formatarSegundos(fim.duracaoS)}`;
  const modelo = fim.modelo ? `, no ${fim.modelo}` : '';
  return `Frank respondeu${duracao}${modelo}.`;
}

// Estado do time movido pelos eventos reais do Hermes. Cartão "trabalhando" enquanto houver subagente aberto;
// "entregue" enquanto houver entrega dele na bandeja; "livre" no resto.
export function criarQuadroDoTime({ agora = () => new Date() } = {}) {
  const trabalhos = new Map();
  const finalizados = new Set();
  const decididas = new Set();
  let pendentes = [];
  // Quadro Kanban do Hermes (GET /api/frank/quadro): o que cada assistente tem lá e as entregas recentes.
  let doQuadro = { lido: false, agentes: {}, pendentes: [] };

  function chaveDoTrabalho(runId, evento) {
    return `${runId}:${evento.subagenteId || `${evento.agente ?? 'frank'}:${evento.tarefa ?? ''}`}`;
  }

  function acharTrabalho(runId, evento) {
    const chave = chaveDoTrabalho(runId, evento);
    if (trabalhos.has(chave) || evento.subagenteId) return chave;
    // Sem subagenteId não há como casar pelo id: fica com o primeiro trabalho aberto do mesmo agente nesse turno.
    for (const [outra, trabalho] of trabalhos) {
      if (trabalho.runId === runId && trabalho.agente === evento.agente) return outra;
    }
    return chave;
  }

  function aplicar(evento, { runId = '', ativa = true } = {}) {
    const efeitos = [];
    switch (evento?.tipo) {
      case 'agente_inicio': {
        const chave = chaveDoTrabalho(runId, evento);
        if (trabalhos.has(chave) || finalizados.has(chave)) return efeitos;
        trabalhos.set(chave, { agente: evento.agente, tarefa: evento.tarefa, runId });
        efeitos.push(evento.agente ? { tipo: 'pulso', agente: evento.agente, sentido: 'saida' } : { tipo: 'nucleo' });
        efeitos.push({
          tipo: 'registro',
          nivel: 'info',
          texto: evento.agente ? `Frank passou para ${artigo(evento.agente)} ${nomeDe(evento.agente)}: ${evento.tarefa}` : `Frank está cuidando direto: ${evento.tarefa}`,
        });
        return efeitos;
      }
      case 'agente_fim': {
        const chave = acharTrabalho(runId, evento);
        if (finalizados.has(chave)) return efeitos;
        finalizados.add(chave);
        const trabalho = trabalhos.get(chave);
        trabalhos.delete(chave);
        const agente = evento.agente ?? trabalho?.agente ?? null;
        const nome = nomeDe(agente);
        efeitos.push(agente ? { tipo: 'pulso', agente, sentido: 'entrada' } : { tipo: 'nucleo' });
        if (evento.status !== 'ok') {
          efeitos.push({ tipo: 'registro', nivel: 'erro', texto: `${nome} não conseguiu terminar: ${trabalho?.tarefa || evento.entrega.titulo}` });
          return efeitos;
        }
        const pendente = {
          chave: chaveDaEntrega(agente, evento.entrega.texto),
          id: null,
          agente,
          titulo: evento.entrega.titulo,
          entrega: evento.entrega.texto,
          arquivo: evento.entrega.arquivo ?? null,
          criadaEm: agora().toISOString(),
          duracaoS: evento.duracaoS,
          runId,
        };
        const naBandeja = ativa && !decididas.has(pendente.chave);
        if (naBandeja && !pendentes.some((item) => item.chave === pendente.chave)) pendentes.push(pendente);
        efeitos.push({ tipo: 'registro', nivel: 'entrega', texto: `${nome} entregou: ${pendente.titulo}${ativa ? '' : ' (em outra demanda)'}` });
        if (naBandeja) efeitos.push({ tipo: 'anuncio', texto: `${nome} entregou ${pendente.titulo}. Está em Para aprovar.` });
        efeitos.push({ tipo: 'entrega', pendente, naBandeja });
        return efeitos;
      }
      case 'ferramenta': {
        // A revisão não vira cartão nem entrega.
        const nome = PREFIXO_DE_MCP.exec(evento.nome)?.[1] ?? evento.nome;
        if (nome === FERRAMENTA_DE_REVISAO) {
          efeitos.push({ tipo: 'registro', nivel: 'info', texto: evento.fase === 'inicio' ? 'Frank pediu uma revisão antes de te entregar.' : 'Revisão concluída.' });
        } else if (evento.fase === 'inicio' && nome && !FERRAMENTAS_SEM_REGISTRO.has(nome)) {
          efeitos.push({ tipo: 'registro', nivel: 'info', texto: `Frank usou a ferramenta ${evento.nome}.` });
        }
        return efeitos;
      }
      case 'fim':
        efeitos.push({ tipo: 'registro', nivel: 'info', texto: textoDoFim(evento) });
        return efeitos;
      case 'erro':
        efeitos.push({ tipo: 'registro', nivel: 'erro', texto: evento.mensagem }, { tipo: 'anuncio', texto: evento.mensagem });
        return efeitos;
      default:
        return efeitos;
    }
  }

  // O turno acabou (fim, erro ou queda): subagente que ficou aberto não está mais trabalhando.
  function encerrarRun(runId) {
    let mudou = false;
    for (const [chave, trabalho] of trabalhos) {
      if (trabalho.runId !== runId) continue;
      trabalhos.delete(chave);
      finalizados.add(chave);
      mudou = true;
    }
    return mudou;
  }

  // O arquivo da demanda manda; ficam só as entregas de turnos ainda abertos que o servidor ainda não gravou.
  function carregarPendentes(lista, { manterRuns = new Set() } = {}) {
    const doServidor = lista.filter((item) => !decididas.has(item.chave));
    const chaves = new Set(doServidor.map((item) => item.chave));
    const vivas = pendentes.filter((item) => item.runId && manterRuns.has(item.runId) && !chaves.has(item.chave));
    pendentes = [
      ...doServidor.map((item) => {
        const local = pendentes.find((outro) => outro.chave === item.chave);
        return local ? { ...item, duracaoS: local.duracaoS, criadaEm: item.criadaEm ?? local.criadaEm, runId: local.runId } : item;
      }),
      ...vivas,
    ];
  }

  function decidir(chave) {
    for (const lista of [pendentes, doQuadro.pendentes]) {
      const indice = lista.findIndex((item) => item.chave === chave);
      if (indice < 0) continue;
      const [pendente] = lista.splice(indice, 1);
      decididas.add(chave);
      return pendente;
    }
    return null;
  }

  function desfazerDecisao(pendente) {
    decididas.delete(pendente.chave);
    const lista = pendente.tarefaId ? doQuadro.pendentes : pendentes;
    if (!lista.some((item) => item.chave === pendente.chave)) lista.push(pendente);
  }

  // Resumo do quadro vindo do servidor. Devolve os efeitos do que mudou desde a leitura anterior; a primeira leitura
  // só monta o estado, sem registro, para não despejar o quadro inteiro ao abrir o painel.
  function carregarQuadro(resumo) {
    const efeitos = [];
    const agentes = resumo?.disponivel && resumo.agentes && typeof resumo.agentes === 'object' ? resumo.agentes : {};
    const entregas = resumo?.disponivel && Array.isArray(resumo.entregas) ? resumo.entregas : [];
    const novas = entregas
      .filter((item) => item && typeof item.chave === 'string' && IDS_DO_TIME.has(item.agente) && !decididas.has(item.chave))
      .map((item) => ({
        chave: item.chave,
        id: null,
        tarefaId: texto(item.tarefaId),
        agente: item.agente,
        titulo: espacosSimples(item.titulo) || 'Entrega sem título',
        entrega: texto(item.texto).trim(),
        arquivo: null,
        criadaEm: texto(item.criadaEm) || null,
        origem: 'quadro',
      }));
    if (doQuadro.lido) {
      for (const [agente, atual] of Object.entries(agentes)) {
        if (!IDS_DO_TIME.has(agente)) continue;
        const antes = doQuadro.agentes[agente];
        if (atual?.status === 'trabalhando' && (antes?.status !== 'trabalhando' || antes.tarefa !== atual.tarefa)) {
          efeitos.push({ tipo: 'pulso', agente, sentido: 'saida' }, { tipo: 'registro', nivel: 'info', texto: `${nomeDe(agente)} começou no quadro: ${atual.tarefa}` });
        } else if (atual?.status === 'travado' && (antes?.status !== 'travado' || antes.tarefa !== atual.tarefa)) {
          efeitos.push({ tipo: 'registro', nivel: 'erro', texto: `${nomeDe(agente)} travou no quadro: ${atual.tarefa}` });
        }
      }
      const conhecidas = new Set(doQuadro.pendentes.map((item) => item.chave));
      for (const pendente of novas) {
        if (conhecidas.has(pendente.chave)) continue;
        efeitos.push(
          { tipo: 'pulso', agente: pendente.agente, sentido: 'entrada' },
          { tipo: 'registro', nivel: 'entrega', texto: `${nomeDe(pendente.agente)} entregou no quadro: ${pendente.titulo}` },
          { tipo: 'anuncio', texto: `${nomeDe(pendente.agente)} entregou ${pendente.titulo}. Está em Para aprovar.` },
        );
      }
    }
    doQuadro = { lido: true, agentes: Object.fromEntries(Object.entries(agentes).filter(([agente]) => IDS_DO_TIME.has(agente))), pendentes: novas };
    return efeitos;
  }

  // Precedência no cartão: trabalhando (delegate_task ou quadro) > travado > entregue > na fila > livre.
  function estado() {
    const abertos = [...trabalhos.values()];
    const todas = [...pendentes, ...doQuadro.pendentes];
    return {
      agentes: AGENTES.map(({ id }) => {
        const dele = abertos.filter((trabalho) => trabalho.agente === id);
        const noQuadro = doQuadro.agentes[id];
        const naFila = Number.isInteger(noQuadro?.naFila) && noQuadro.naFila > 0 ? noQuadro.naFila : 0;
        if (dele.length > 0) return { id, status: 'trabalhando', tarefa: dele.at(-1).tarefa, progresso: 0, fila: dele.length - 1, naFila };
        if (noQuadro?.status === 'trabalhando') {
          return { id, status: 'trabalhando', tarefa: espacosSimples(noQuadro.tarefa), progresso: 0, fila: Math.max(0, Number(noQuadro.paralelas) || 0), naFila };
        }
        if (noQuadro?.status === 'travado') return { id, status: 'travado', tarefa: espacosSimples(noQuadro.tarefa), progresso: 0, fila: 0, naFila };
        const entregue = todas.findLast((item) => item.agente === id);
        if (entregue) return { id, status: 'entregue', tarefa: entregue.titulo, progresso: 1, fila: 0, naFila };
        if (noQuadro?.status === 'fila') return { id, status: 'fila', tarefa: espacosSimples(noQuadro.tarefa), progresso: 0, fila: 0, naFila };
        return { id, status: 'livre', tarefa: '', progresso: 0, fila: 0, naFila: 0 };
      }),
      pendentes: todas.map((item) => ({ ...item })),
      frankTrabalhando: abertos.filter((trabalho) => trabalho.agente === null).length,
    };
  }

  return {
    aplicar,
    encerrarRun,
    carregarPendentes,
    carregarQuadro,
    decidir,
    desfazerDecisao,
    pendente: (chave) => pendentes.find((item) => item.chave === chave) ?? doQuadro.pendentes.find((item) => item.chave === chave) ?? null,
    limparPendentes() {
      pendentes = [];
    },
    estado,
  };
}

// Textos de decisão do contrato; o servidor casa com /^Aprovo a entrega d[ao] (\p{L}+): (.+)$/ e o par do ajuste.
// Entrega do quadro Kanban leva o id da tarefa: o Frank acha a tarefa no quadro, e o servidor tira a entrega da bandeja.
// O "no quadro" depois do nome deixa o texto fora do formato das entregas da demanda.
const noQuadro = (tarefaId) => (tarefaId ? ` no quadro (tarefa ${tarefaId}` : '');

export function textoDeAprovar({ agente, titulo, tarefaId }) {
  const quem = `d${artigo(agente)} ${nomeDe(agente)}${tarefaId ? `${noQuadro(tarefaId)})` : ''}`;
  return `Aprovo a entrega ${quem}: ${semPontoFinal(titulo) || 'entrega sem título'}.`;
}

export function textoDeDescartar({ agente, titulo, tarefaId }) {
  const quem = `d${artigo(agente)} ${nomeDe(agente)}${tarefaId ? `${noQuadro(tarefaId)})` : ''}`;
  return `Descarto a entrega ${quem}: ${semPontoFinal(titulo) || 'entrega sem título'}.`;
}

export function textoDeAjuste({ agente, titulo, tarefaId }, observacao) {
  const nota = espacosSimples(observacao) || 'refaz com outra abordagem';
  const final = /[.!?…]$/u.test(nota) ? nota : `${nota}.`;
  const titulado = semPontoFinal(titulo) || 'entrega sem título';
  if (tarefaId) return `Ajuste na entrega d${artigo(agente)} ${nomeDe(agente)}${noQuadro(tarefaId)}, ${titulado}): ${final}`;
  return `Ajuste na entrega d${artigo(agente)} ${nomeDe(agente)} (${titulado}): ${final}`;
}

function linhaDoPedido(pedido) {
  const comando = cortarFrase(pedido.comando, LIMITE_DO_COMANDO_NO_REGISTRO);
  if (comando) return `O Frank pediu sua autorização para rodar “${comando}”.`;
  return `O Frank pediu sua autorização: ${semPontoFinal(pedido.descricao) || 'comando sinalizado pelo Hermes'}.`;
}

// Sem o pedido (o cartão já tinha fechado por um 409), a linha sai sem o comando.
function linhaDoDesfecho(decisao, pedido) {
  const comando = cortarFrase(pedido?.comando, LIMITE_DO_COMANDO_NO_REGISTRO);
  if (decisao === 'sim') return comando ? `Você autorizou o comando “${comando}”.` : 'Você autorizou o comando do Frank.';
  if (decisao === 'nao') return comando ? `Você não autorizou o comando “${comando}”. Ele não rodou.` : 'Você não autorizou o comando do Frank. Ele não rodou.';
  if (decisao === 'expirou') return TEXTO_SEM_RESPOSTA;
  return 'O pedido de autorização do Frank foi encerrado.';
}

function desfechoNoRegistro(decisao, pedido) {
  return { texto: linhaDoDesfecho(decisao, pedido), nivel: decisao === 'sim' ? 'autorizacao' : decisao === 'expirou' ? 'erro' : 'info' };
}

// Pedidos de autorização do Hermes (comando destrutivo pausa o run): um por turno, mostrados por ordem de chegada.
// O desfecho entra no registro uma vez só: quem chegar primeiro (200 do clique ou aprovacao_fim do stream) registra.
export function criarAutorizacoes() {
  const pedidos = new Map();
  // Resposta aceita pelo servidor cujo aprovacao_fim ainda não chegou: evita linha dobrada e pedido reaberto pela repetição.
  const respondidos = new Map();
  let aviso = '';

  function abrir(evento, { runId = '', delegacaoId = null } = {}) {
    const mesmo = (outro) => outro && (evento.requestId ? outro.requestId === evento.requestId : outro.comando === evento.comando && outro.descricao === evento.descricao);
    // Na reconexão a ponte repete o pedido enquanto o run espera: o mesmo pedido não reabre nem pede de novo por voz.
    if (mesmo(pedidos.get(runId)) || mesmo(respondidos.get(runId))) return { novo: false };
    const pedido = { runId, ...(evento.requestId ? { requestId: evento.requestId } : {}), comando: evento.comando, descricao: evento.descricao, delegacaoId, enviando: null, erro: '' };
    pedidos.set(runId, pedido);
    respondidos.delete(runId);
    aviso = '';
    return { novo: true, pedido: { ...pedido }, registro: { texto: linhaDoPedido(pedido), nivel: 'autorizacao' } };
  }

  // Clique em Autorizar ou Não autorizar: false quando não há pedido aberto ou a resposta já está indo.
  function enviar(runId, decisao, requestId) {
    const pedido = pedidos.get(runId);
    if (!pedido || (requestId !== undefined && pedido.requestId !== requestId) || pedido.enviando || (decisao !== 'sim' && decisao !== 'nao')) return false;
    pedido.enviando = decisao;
    pedido.erro = '';
    return true;
  }

  function falhouEnvio(runId, mensagem, requestId) {
    const pedido = pedidos.get(runId);
    if (!pedido || (requestId !== undefined && pedido.requestId !== requestId)) return false;
    pedido.enviando = null;
    pedido.erro = espacosSimples(mensagem) || 'Não deu para enviar a resposta.';
    return true;
  }

  // O servidor aceitou a resposta, pelo clique ou pela voz.
  function confirmar(runId, decisao, requestId) {
    const pedido = pedidos.get(runId);
    if (!pedido || (requestId !== undefined && pedido.requestId !== requestId)) return { fechou: false };
    pedidos.delete(runId);
    respondidos.set(runId, { decisao, requestId: pedido.requestId, comando: pedido.comando, descricao: pedido.descricao });
    return { fechou: true, pedido: { ...pedido }, registro: desfechoNoRegistro(decisao, pedido) };
  }

  // 409 da rota: a voz ou o prazo já resolveram. Fecha sem aviso; o aprovacao_fim registra o desfecho de verdade.
  function descartar(runId, requestId) {
    if (requestId !== undefined && pedidos.get(runId)?.requestId !== requestId) return false;
    return pedidos.delete(runId);
  }

  function finalizar(runId, decisao, requestId) {
    const pedido = pedidos.get(runId) ?? null;
    const respondido = respondidos.get(runId);
    const atual = pedido ?? respondido;
    if (requestId !== undefined && atual && atual.requestId !== requestId) return { fechou: false };
    pedidos.delete(runId);
    respondidos.delete(runId);
    if (respondido && respondido.decisao === decisao) return { fechou: Boolean(pedido) };
    if (decisao === 'expirou') aviso = TEXTO_SEM_RESPOSTA;
    return { fechou: Boolean(pedido), registro: desfechoNoRegistro(decisao, pedido), aviso: decisao === 'expirou' ? aviso : '' };
  }

  // O turno acabou (fim ou erro do Hermes): pedido que ficou aberto não tem mais a quem responder.
  function encerrarRun(runId) {
    respondidos.delete(runId);
    return pedidos.delete(runId);
  }

  function dispensarAviso() {
    const tinha = Boolean(aviso);
    aviso = '';
    return tinha;
  }

  function estado() {
    const [primeiro] = pedidos.values();
    if (primeiro) return { fase: 'aberto', pedido: { ...primeiro }, fila: pedidos.size - 1 };
    if (aviso) return { fase: 'aviso', aviso };
    return { fase: 'fechado' };
  }

  return { abrir, enviar, falhouEnvio, confirmar, descartar, finalizar, encerrarRun, dispensarAviso, estado };
}

// Commentary para o GPT Live pedir o sim ou o não em voz. Ele parafraseia: o comando vai cortado, e inteiro só no cartão.
export function textoDoPedidoDeAutorizacao({ comando, descricao } = {}) {
  const linha = cortarFrase(comando, LIMITE_DO_COMANDO_NA_FALA);
  const oQue = semPontoFinal(descricao);
  if (linha) return `Antes de seguir, preciso da sua autorização pra rodar ${linha}${oQue ? ` (${oQue})` : ''}. Tá na tela. Posso rodar? Sim ou não.`;
  return `Antes de seguir, preciso da sua autorização: ${oQue || 'um comando que pode apagar ou mudar algo'}. Tá na tela. Posso seguir? Sim ou não.`;
}

// A fala não foi um sim nem um não (409 com aprovacaoPendente): o Frank repete o pedido.
export function textoDeAutorizacaoPendente({ comando, descricao } = {}) {
  const linha = cortarFrase(comando, LIMITE_DO_COMANDO_NA_FALA);
  if (linha) return `Ainda preciso da sua resposta antes de seguir: posso rodar ${linha}? É só dizer sim ou não.`;
  return `Ainda preciso da sua resposta antes de seguir: ${semPontoFinal(descricao) || 'um comando que pode apagar ou mudar algo'}. É só dizer sim ou não.`;
}

export function registroDaAutorizacaoPendente({ comando, descricao } = {}) {
  const linha = cortarFrase(comando, LIMITE_DO_COMANDO_NO_REGISTRO);
  const frase = linha
    ? `O Frank ainda espera a sua autorização para rodar “${linha}”. Responda sim ou não.`
    : `O Frank ainda espera a sua autorização: ${semPontoFinal(descricao) || 'comando sinalizado pelo Hermes'}. Responda sim ou não.`;
  return { texto: frase, nivel: 'autorizacao' };
}

export function textoDaRespostaPorVoz(decisao) {
  return decisao === 'sim' ? 'Beleza, autorizado. Sigo com o comando agora.' : 'Tranquilo, não rodo esse comando.';
}

export function textoDoAnuncioDeAutorizacao({ comando, descricao } = {}) {
  const partes = ['O Frank precisa da sua autorização.'];
  const oQue = semPontoFinal(descricao);
  if (oQue) partes.push(`${oQue}.`);
  const linha = cortarFrase(comando, LIMITE_DO_COMANDO_NO_REGISTRO);
  if (linha) partes.push(`Comando: ${linha}.`);
  return partes.join(' ');
}

// thinking curto por agente para o GPT Live enquanto o time trabalha.
export function textoDoPensamento(agente, tarefa) {
  const sujeito = agente ? `${artigo(agente).toUpperCase()} ${nomeDe(agente)} ${VERBOS[agente]}` : 'O Frank tá cuidando disso direto';
  const curta = cortarFrase(tarefa, LIMITE_DA_TAREFA_NO_PENSAMENTO);
  return curta ? `${sujeito}: ${curta}` : `${sujeito}.`;
}

// O que o Frank está fazendo agora, na linha de estado embaixo do núcleo. Os nomes são os das ferramentas do Hermes
// (hermes-agent/tools); ferramenta de MCP chega com o prefixo mcp__<servidor>__.
const ATIVIDADES_DAS_FERRAMENTAS = [
  [/^(web_search|x_search)$/, 'Pesquisando na web'],
  [/^web_extract$/, 'Lendo uma página da web'],
  [/^(browser_|computer_use$)/, 'Mexendo no navegador'],
  [/^(read_file|search_files)$/, 'Lendo arquivos'],
  [/^(write_file|patch)$/, 'Escrevendo um arquivo'],
  [/^(terminal|execute_code|process_manage|read_terminal)$/, 'Rodando um comando no computador'],
  [/^(skill_view|skills_list)$/, 'Consultando o manual do time'],
  [/^(memory|session_search)$/, 'Consultando a memória'],
  [/^(vision_analyze|video_analyze)$/, 'Analisando uma imagem'],
  [/^(image_generate|video_generate)$/, 'Criando uma imagem'],
  [/^todo_list$/, 'Organizando as tarefas'],
];

// Evento do turno → texto da atividade, ou null quando o evento não muda o que aparece.
export function textoDaAtividade(evento) {
  if (evento?.tipo === 'agente_inicio') return textoDoPensamento(evento.agente, evento.tarefa);
  if (evento?.tipo === 'agente_fim') return 'Frank juntando o que o time entregou…';
  if (evento?.tipo !== 'ferramenta' || evento.fase !== 'inicio') return null;
  const nome = PREFIXO_DE_MCP.exec(evento.nome)?.[1] ?? evento.nome;
  if (nome === FERRAMENTA_DE_REVISAO) return 'Frank revisando antes de te entregar…';
  if (FERRAMENTAS_SEM_REGISTRO.has(nome)) return null;
  const rotulo = ATIVIDADES_DAS_FERRAMENTAS.find(([padrao]) => padrao.test(nome))?.[1];
  return `${rotulo ?? 'Frank trabalhando no pedido'}…`;
}

// O pedido do turno é a última fala do usuário na janela de transcrição (a delegação não traz texto).
export function falaDoPedido(turnos) {
  const ultimo = [...(turnos ?? [])].reverse().find((turno) => turno.quem === 'usuario' && espacosSimples(turno.texto));
  return espacosSimples(ultimo?.texto);
}

export function textoDoAvisoDeEntregas(entregas) {
  const titulo = (entrega) => `"${cortarFrase(semPontoFinal(entrega.titulo), LIMITE_DO_TITULO_NO_AVISO)}"`;
  if (entregas.length === 1) return `${nomeDe(entregas[0].agente)} entregou ${titulo(entregas[0])}. Tá na bandeja para aprovar.`;
  const itens = entregas.map((entrega) => `${nomeDe(entrega.agente)}, ${titulo(entrega)}`);
  return `Chegaram ${entregas.length} entregas para aprovar: ${itens.join('; ')}.`;
}

// Marcação leve que os assistentes do Hermes usam (negrito com **). Trechos para montar nós de texto, sem HTML.
export function trechosComDestaque(valor) {
  const corpo = texto(valor);
  const partes = corpo.split('**');
  if (partes.length < 3 || partes.length % 2 === 0) return corpo ? [{ texto: corpo, forte: false }] : [];
  return partes.map((parte, indice) => ({ texto: parte, forte: indice % 2 === 1 })).filter((parte) => parte.texto);
}

export function textoSemMarcacao(valor) {
  return trechosComDestaque(valor).map((parte) => parte.texto).join('').replace(/^#{1,6}\s+/gm, '');
}

export function formatarQuando(iso, agora = new Date()) {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  const inicioDoDia = (valor) => new Date(valor.getFullYear(), valor.getMonth(), valor.getDate()).getTime();
  const dias = Math.round((inicioDoDia(agora) - inicioDoDia(data)) / DIA_EM_MS);
  const hora = HORA.format(data);
  if (dias === 0) return `hoje, ${hora}`;
  if (dias === 1) return `ontem, ${hora}`;
  return `${DIA_E_MES.format(data).replace(/\.$/, '')}, ${hora}`;
}

// Cérebro que vai no POST do turno: null quando vale o padrão do Hermes. Com a lista de modelos em mãos,
// só sai o que o servidor aceita (resolverCerebro devolve 400 para provedor, modelo ou esforço fora da lista).
// O fast só aparece ligado, e só num modelo que o Hermes diz aceitar; fora disso o turno vai no modo normal.
export function cerebroDoPedido(preferido, modelos) {
  if (!preferido || typeof preferido !== 'object' || !preferido.provedor || !preferido.modelo) return null;
  const comFast = (cerebro, fast) => (fast ? { ...cerebro, fast: true } : cerebro);
  const provedores = Array.isArray(modelos?.provedores) ? modelos.provedores : null;
  if (!provedores) return comFast({ provedor: preferido.provedor, modelo: preferido.modelo, esforco: preferido.esforco ?? null }, preferido.fast === true);
  const provedor = provedores.find((item) => item.id === preferido.provedor);
  if (!provedor || !provedor.modelos?.includes(preferido.modelo)) return null;
  return comFast(
    { provedor: provedor.id, modelo: preferido.modelo, esforco: esforcoValido(provedor, preferido.esforco) },
    preferido.fast === true && fastDisponivel(provedor, preferido.modelo),
  );
}

export function fastDisponivel(provedor, modelo) {
  return Array.isArray(provedor?.rapidos) && provedor.rapidos.includes(modelo);
}

export function esforcoValido(provedor, esforco) {
  const esforcos = Array.isArray(provedor?.esforcos) ? provedor.esforcos : [];
  if (esforcos.length === 0) return null;
  if (esforcos.includes(esforco)) return esforco;
  return esforcos.includes('medio') ? 'medio' : esforcos[0];
}

// O que o Frank usa no próximo turno: a escolha válida ou o padrão do Hermes.
export function cerebroEmUso(preferido, modelos) {
  const escolhido = cerebroDoPedido(preferido, modelos);
  if (escolhido) return escolhido;
  const padrao = modelos?.padrao;
  return padrao && typeof padrao === 'object' && padrao.modelo ? { provedor: padrao.provedor ?? null, modelo: padrao.modelo, esforco: padrao.esforco ?? null } : null;
}

// Nome em português pelo id; provedor fora do mapa fica com o nome que o Hermes manda.
export function nomeDoProvedor(provedor) {
  return NOMES_DOS_PROVEDORES[provedor?.id] ?? (espacosSimples(provedor?.nome) || texto(provedor?.id));
}

// O dono só quer pagar a voz por uso: o cabeçalho e o diálogo dizem quem paga o cérebro em uso.
// Antes de a lista do Hermes chegar, sem escolha salva, fica o texto que a página já traz.
export function custoDoCerebro(cerebro, modelos) {
  const id = texto(cerebro?.provedor);
  if (!id || Object.hasOwn(NOMES_DOS_PROVEDORES, id)) {
    return {
      assinatura: true,
      rotulo: 'cérebro: assinatura',
      nota: 'Roda no Hermes, com a sua assinatura.',
      titulo: 'O cérebro do Frank roda no Hermes, com a sua assinatura.',
    };
  }
  const lista = Array.isArray(modelos?.provedores) ? modelos.provedores : [];
  const nome = nomeDoProvedor(lista.find((item) => item?.id === id) ?? { id });
  return {
    assinatura: false,
    rotulo: `cérebro: ${nome}`,
    nota: 'Roda no Hermes, cobrado pelo provedor.',
    titulo: `O cérebro do Frank roda no Hermes, cobrado pelo provedor (${nome}).`,
  };
}

export function rotuloDoEsforco(esforco) {
  const rotulo = ROTULOS_DE_ESFORCO[esforco] ?? texto(esforco);
  return rotulo;
}

export function rotuloDoCerebro(cerebro) {
  if (!cerebro?.modelo) return '';
  const rotulo = cerebro.esforco ? `${cerebro.modelo} · ${rotuloDoEsforco(cerebro.esforco)}` : cerebro.modelo;
  return cerebro.fast ? `${rotulo} · fast` : rotulo;
}

function formatarDuracao(ms) {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return ms === 3_600_000 ? '1 hora' : `${ms / 3_600_000} horas`;
  if (ms >= 60_000 && ms % 60_000 === 0) return ms === 60_000 ? '1 minuto' : `${ms / 60_000} minutos`;
  return formatarSegundos(ms / 1000);
}

// Motivo do corte do stream pela vigia: `silencio` (servidor calado) ou `teto` (turno longo demais).
export class ErroDeStreamParado extends Error {
  constructor(motivo, limiteMs) {
    super(motivo === 'teto'
      ? `O turno passou de ${formatarDuracao(limiteMs)} sem terminar.`
      : `O servidor passou ${formatarDuracao(limiteMs)} sem dar sinal do turno; a conexão parece ter caído.`);
    this.name = 'ErroDeStreamParado';
    this.motivo = motivo;
    this.limiteMs = limiteMs;
  }
}

// Vigia do stream do turno. O relógio é trocável nos testes. Dispara o sinal com `silencio` quando passam `silencioMs`
// sem armar() (a leitura arma a cada pedaço que chega, keepalive incluído) ou com `teto` no fim do prazo total.
export function criarVigiaDoTurno({ silencioMs = SILENCIO_MAXIMO_DO_STREAM_MS, tetoMs = DURACAO_MAXIMA_DO_TURNO_MS, relogio = RELOGIO_REAL } = {}) {
  const controle = new AbortController();
  let silencio = null;
  let teto = null;

  function soltar() {
    if (silencio !== null) relogio.cancelar(silencio);
    if (teto !== null) relogio.cancelar(teto);
    silencio = null;
    teto = null;
  }

  function parar(motivo, limiteMs) {
    soltar();
    controle.abort(new ErroDeStreamParado(motivo, limiteMs));
  }

  function armar() {
    if (controle.signal.aborted) return;
    if (silencio !== null) relogio.cancelar(silencio);
    silencio = relogio.agendar(() => parar('silencio', silencioMs), silencioMs);
  }

  teto = relogio.agendar(() => parar('teto', tetoMs), tetoMs);
  armar();
  return { sinal: controle.signal, armar, soltar };
}

// read() que desiste quando o sinal dispara: com o servidor calado, o read sozinho esperaria para sempre.
function lerAteOSinal(leitor, sinal) {
  if (!sinal) return leitor.read();
  if (sinal.aborted) return Promise.reject(sinal.reason);
  return new Promise((resolver, rejeitar) => {
    const desistir = () => rejeitar(sinal.reason);
    sinal.addEventListener('abort', desistir, { once: true });
    leitor.read().then(resolver, rejeitar).finally(() => sinal.removeEventListener('abort', desistir));
  });
}

// SSE lido por fetch (o EventSource não manda o x-frank-code): devolve o conteúdo de cada `data:`.
// aoReceber roda a cada pedaço que chega, comentário de keepalive incluído; o sinal interrompe a leitura.
export async function* lerEventosSse(corpo, { sinal, aoReceber } = {}) {
  const leitor = corpo.pipeThrough(new TextDecoderStream()).getReader();
  let resto = '';
  try {
    for (;;) {
      const { value, done } = await lerAteOSinal(leitor, sinal);
      if (done) return;
      aoReceber?.();
      resto += value;
      let separador;
      while ((separador = /\r?\n\r?\n/.exec(resto))) {
        const bloco = resto.slice(0, separador.index);
        resto = resto.slice(separador.index + separador[0].length);
        const dados = dadosDoBloco(bloco);
        if (dados !== null) yield dados;
      }
    }
  } finally {
    leitor.cancel().catch(() => {});
  }
}

function dadosDoBloco(bloco) {
  const linhas = [];
  for (const linha of bloco.split(/\r?\n/)) {
    if (!linha || linha.startsWith(':')) continue;
    const posicao = linha.indexOf(':');
    const campo = posicao < 0 ? linha : linha.slice(0, posicao);
    if (campo === 'data') linhas.push(posicao < 0 ? '' : linha.slice(posicao + 1).replace(/^ /, ''));
  }
  return linhas.length ? linhas.join('\n') : null;
}

export class ErroDoTurno extends Error {
  constructor(mensagem, { doHermes = false, aprovacaoPendente = null, cause } = {}) {
    super(mensagem, { cause });
    this.name = 'ErroDoTurno';
    this.doHermes = doHermes;
    // { comando, descricao } quando o turno não abriu porque o Frank ainda espera uma autorização.
    this.aprovacaoPendente = aprovacaoPendente;
  }
}

// runId e requestId vêm no 409 para o painel recarregado remontar o cartão; aceita os dois dentro ou fora do pedido.
function pedidoPendenteDoErro(erro) {
  const corpo = erro?.status === 409 ? erro.corpo : null;
  const pendente = corpo?.aprovacaoPendente;
  if (!pendente || typeof pendente !== 'object') return null;
  return {
    comando: texto(pendente.comando).trim(),
    descricao: espacosSimples(pendente.descricao),
    runId: texto(pendente.runId ?? corpo.runId).trim() || null,
    requestId: texto(pendente.requestId ?? corpo.requestId).trim() || null,
  };
}

// Pedido de pé que voltou num 409 do turno. Com o runId, o cartão volta e o clique funciona (aba recarregada no meio
// da espera); sem ele, null, e só a voz responde.
export function pedidoDoConflito(aprovacaoPendente) {
  const runId = texto(aprovacaoPendente?.runId).trim();
  if (!runId) return null;
  return { runId, evento: { tipo: 'aprovacao', comando: texto(aprovacaoPendente.comando).trim(), descricao: espacosSimples(aprovacaoPendente.descricao), ...(aprovacaoPendente.requestId ? { requestId: aprovacaoPendente.requestId } : {}) } };
}

// Voz sob demanda. A sessão do GPT Live é a única API paga: ela abre por um gatilho (toque, Espaço, chamado pelo nome
// ou algo que o Hermes trouxe para falar) e dorme logo depois. O turno do Hermes segue no SSE do painel, sem a voz.

// A transcrição do áudio às vezes troca de alfabeto no meio da frase ("como te responder" virou "как те ответь"):
// a legenda tira a palavra que tem letra fora do alfabeto latino. Acento e pontuação ficam.
const PALAVRA_DE_OUTRA_ESCRITA = /\S*(?:(?!\p{Script=Latin})\p{L})\S*/gu;

export function semOutraEscrita(texto) {
  return String(texto ?? '').replace(PALAVRA_DE_OUTRA_ESCRITA, '').replace(/[ \t]{2,}/g, ' ');
}

export const TEXTO_EM_ESPERA = 'Em espera. Toque no núcleo ou aperte Espaço para acordar.';
export const TEXTO_EM_ESPERA_COM_ESCUTA = 'Em espera. Chame “Frank”, toque no núcleo ou aperte Espaço.';
// Grafias que o reconhecimento do Chrome em pt-BR devolve para "Frank". A comparação é por palavra inteira, sem caixa
// e sem acento: "franco", "França" e "Frankenstein" não acordam a voz.
export const VARIACOES_DO_CHAMADO = Object.freeze(['frank', 'franc', 'franck']);
// Com o nome e só estas palavras ("Oi, Frank", "E aí, Frank, tudo bem?") o usuário só chamou: o Frank cumprimenta e espera.
const PALAVRAS_DE_CUMPRIMENTO = new Set(['oi', 'ola', 'ei', 'hey', 'e', 'ai', 'eai', 'fala', 'alo', 'opa', 'salve', 'o', 'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem', 'beleza', 'ta', 'acorda']);
const LIMITE_DO_CHAMADO = 600;
const LIMITE_DO_PEDIDO_NO_ERRO = 120;

const palavrasDaFala = (fala) => semAcento(fala).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const eChamado = (palavra) => VARIACOES_DO_CHAMADO.includes(palavra);

export function temChamadoDoFrank(fala) {
  return palavrasDaFala(fala).some(eChamado);
}

// Fuso do navegador (IANA), para o servidor dizer a hora certa aos modelos; vazio quando o navegador não informa.
export function fusoDoNavegador() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

export function soChamouOFrank(fala) {
  const palavras = palavrasDaFala(fala);
  return palavras.some(eChamado) && palavras.every((palavra) => eChamado(palavra) || PALAVRAS_DE_CUMPRIMENTO.has(palavra));
}

export function textoDaEspera({ escutando = false } = {}) {
  return escutando ? TEXTO_EM_ESPERA_COM_ESCUTA : TEXTO_EM_ESPERA;
}

const NOTA_DA_ESCUTA = 'O reconhecimento do Chrome ouve enquanto a voz dorme e manda o áudio para o Google, sem custo.';

// Linha de ajuda de "Acordar quando eu chamar o Frank", conforme a escuta está.
export function notaDaEscuta(situacao) {
  if (situacao === 'indisponivel') return { texto: 'Este navegador não tem o reconhecimento de fala do Chrome. Acorde o Frank pelo núcleo ou pelo Espaço.', alerta: true };
  if (situacao === 'bloqueada') return { texto: 'O navegador bloqueou o microfone para a escuta. Libere no cadeado da barra de endereço.', alerta: true };
  if (situacao === 'falhou') return { texto: 'A escuta caiu (rede ou microfone ocupado) e tenta de novo sozinha.', alerta: true };
  if (situacao === 'sem-microfone') return { texto: `${NOTA_DA_ESCUTA} Ela começa depois que você liberar o microfone, na primeira vez que acordar o Frank.`, alerta: false };
  return { texto: NOTA_DA_ESCUTA, alerta: false };
}

// A voz dorme depois de `esperaMs` sem fala de nenhum dos dois e sem fim de turno, mesmo com turno aberto no Hermes.
// O que o turno trouxer para falar acorda a voz de novo. Com o Frank falando ou aviso na fila, ela não dorme.
export function vozDeveDormir({ agora, esperaMs, frankFalando = false, avisosNaFila = 0, ultimaVozDoUsuario = 0, ultimaVozDoFrank = 0, ultimoFimDeTurno = 0 }) {
  if (frankFalando || avisosNaFila > 0) return false;
  return agora - Math.max(ultimaVozDoUsuario, ultimaVozDoFrank, ultimoFimDeTurno) > esperaMs;
}

// O Hermes trouxe algo para o Frank falar: o fim de um turno, um pedido de autorização ou um erro.
// Com a voz acordada, ele fala já; dormindo, o painel acorda a sessão; conectando, o aviso entra na abertura.
// Gatilho de teste nunca acorda a voz paga.
export function destinoDoAviso({ sessao, podeAcordar = true }) {
  if (sessao === 'ativa') return 'falar';
  if (!podeAcordar) return 'ignorar';
  if (sessao === 'conectando') return 'esperar';
  return 'acordar';
}

// Avisos que esperam a voz. Se acordar falhar, eles ficam para a próxima vez que a sessão abrir.
// A chave deixa um aviso só por pedido de autorização, e ele sai da fila quando o pedido se resolve.
export function criarAvisosDaVoz() {
  let fila = [];
  return {
    adicionar({ tipo, texto: corpo, chave = null }) {
      const limpo = espacosSimples(corpo);
      if (!limpo) return false;
      if (chave) fila = fila.filter((aviso) => aviso.chave !== chave);
      fila.push({ tipo, texto: limpo, chave });
      return true;
    },
    descartar(chave) {
      const antes = fila.length;
      fila = fila.filter((aviso) => aviso.chave !== chave);
      return fila.length !== antes;
    },
    retirar() {
      const entregues = fila;
      fila = [];
      return entregues;
    },
    pendentes: () => fila.map((aviso) => ({ ...aviso })),
    get tamanho() {
      return fila.length;
    },
  };
}

export function instrucaoDaSaudacao(frase) {
  return `Cumprimente agora, sem esperar o usuário falar, com esta frase: "${espacosSimples(frase)}" Fale uma vez só, depois pare e escute.`;
}

// O GPT Live em delegação do cliente não aceita mensagem de texto do usuário (conversation.item.create e response.create
// são de outra API). A fala que acordou a voz vai como instrução de sistema, e o motor põe o mesmo texto na janela de
// transcrição: a delegação que vier dela sai com esse pedido, uma vez só.
function instrucaoDoChamado(nome, fala) {
  return `${espacosSimples(nome) || 'O usuário'} chamou você com a voz dormindo e disse: "${cortarFrase(fala, LIMITE_DO_CHAMADO)}" Trate essa fala como se ele tivesse acabado de dizer agora: responda já, sem saudação e sem pedir para repetir, seguindo a sua política de delegação de sempre.`;
}

// O que o Frank faz assim que a sessão abre. Pedido feito ao chamar vem primeiro, e os avisos esperam a vez dele;
// sem pedido, os avisos do Hermes abrem a conversa como commentary (o canal dos resultados que o GPT Live fala);
// sem nada, a saudação de sempre.
export function aberturaDaSessao({ nome, saudacao, chamado = '', avisos = [] }) {
  const fala = espacosSimples(chamado);
  const validos = avisos.filter((aviso) => espacosSimples(aviso?.texto));
  if (fala && !soChamouOFrank(fala)) return { tipo: 'chamado', instrucao: instrucaoDoChamado(nome, fala), falaDoUsuario: fala, depois: validos };
  if (validos.length > 0) return { tipo: 'aviso', comentario: validos.map((aviso) => espacosSimples(aviso.texto)).join(' '), depois: [] };
  return { tipo: 'saudacao', instrucao: instrucaoDaSaudacao(saudacao), depois: [] };
}

// Turno pedido por voz que falhou com a voz já dormindo: a sessão que ouviu o pedido não existe mais, então o aviso lembra qual era.
export function textoDoErroComVozDormindo(pedido) {
  const linha = cortarFrase(pedido, LIMITE_DO_PEDIDO_NO_ERRO);
  return linha
    ? `Travei aqui do meu lado no pedido “${linha}”, e o time não terminou. Se ainda precisar, é só pedir de novo.`
    : 'Travei aqui do meu lado, e o time não terminou o último pedido. Se ainda precisar, é só pedir de novo.';
}

export function textoDoSonoDaVoz({ segundos, turnoAberto = false }) {
  const base = `A voz dormiu depois de ${segundos} s sem fala.`;
  return turnoAberto ? `${base} O time segue trabalhando, e o Frank volta a falar quando o turno terminar.` : base;
}

// Um turno do Frank: POST /api/frank/turno e o SSE de eventos até `fim` (resolve) ou `erro` (rejeita).
// Sem demanda ativa o servidor cria uma, e a saudação que o Frank falou ao acordar vira o histórico semente.
// Com autorização pendente na demanda, o texto é a resposta a ela: o servidor devolve `aprovacao` e não abre run novo.
// relogio: só os testes trocam, para a vigia de silêncio e o teto rodarem sem esperar o tempo de verdade.
export async function rodarTurno({ api, texto: pedido, demandaId = null, cerebro = null, saudacao = '', aprovacao = null, sinal, aoAceito, aoEvento, relogio }) {
  const corpo = { texto: pedido, fuso: fusoDoNavegador() };
  if (demandaId) corpo.demandaId = demandaId;
  else if (espacosSimples(saudacao)) corpo.saudacao = espacosSimples(saudacao).slice(0, 500);
  if (cerebro) corpo.cerebro = cerebro;
  if (aprovacao?.requestId && aprovacao?.runId) corpo.aprovacao = { runId: aprovacao.runId, requestId: aprovacao.requestId };
  let aceito;
  try {
    aceito = await api.json('/api/frank/turno', { metodo: 'POST', corpo, sinal, timeoutMs: 20_000 });
  } catch (erro) {
    const aprovacaoPendente = pedidoPendenteDoErro(erro);
    if (aprovacaoPendente) throw new ErroDoTurno(erro.message || 'O Frank ainda espera a sua autorização.', { aprovacaoPendente, cause: erro });
    throw erro;
  }
  const runId = texto(aceito?.runId).trim();
  // O turno que pediu a autorização segue no SSE que já está aberto. Sai antes do aoAceito: o run pausado não é deste turno.
  if (aceito?.aprovacao === 'sim' || aceito?.aprovacao === 'nao') {
    return { runId, demandaId: texto(aceito.demandaId) || demandaId, ...(aceito.requestId ? { requestId: aceito.requestId } : {}), aprovacao: aceito.aprovacao };
  }
  if (!runId) throw new ErroDoTurno('O servidor aceitou o pedido, mas não devolveu o turno do Hermes.');
  const turno = { runId, demandaId: texto(aceito.demandaId) || demandaId };
  aoAceito?.(turno);

  return acompanharTurno({ api, ...turno, sinal, aoEvento, relogio });
}

// Reanexa um run persistido sem reenviar o pedido nem gerar uma segunda execução.
export async function acompanharTurno({ api, runId, demandaId, sinal, aoEvento, relogio }) {
  const turno = { runId, demandaId };
  const vigia = criarVigiaDoTurno({ relogio });
  try {
    // O timeoutMs do fetch fica de reserva: quem corta no teto, com a mensagem certa, é a vigia.
    const sinalDoStream = sinal ? AbortSignal.any([sinal, vigia.sinal]) : vigia.sinal;
    const resposta = await api.resposta(`/api/frank/turno/${encodeURIComponent(runId)}/eventos`, { sinal: sinalDoStream, timeoutMs: DURACAO_MAXIMA_DO_TURNO_MS });
    vigia.armar();
    if (!resposta.body) throw new ErroDoTurno('O servidor abriu o turno sem a lista de eventos.');
    for await (const dados of lerEventosSse(resposta.body, { sinal: sinalDoStream, aoReceber: vigia.armar })) {
      let bruto;
      try {
        bruto = JSON.parse(dados);
      } catch {
        continue;
      }
      const evento = normalizarEvento(bruto);
      if (!evento) continue;
      aoEvento?.(evento, turno);
      if (evento.tipo === 'fim') return { ...turno, fim: evento };
      if (evento.tipo === 'erro') throw new ErroDoTurno(evento.mensagem, { doHermes: true });
    }
  } catch (erro) {
    if (sinal?.aborted || erro instanceof ErroDoTurno || erro?.name === 'ErroApi') throw erro;
    if (vigia.sinal.aborted) throw new ErroDoTurno(vigia.sinal.reason.message, { cause: vigia.sinal.reason });
    if (erro?.name === 'TimeoutError') throw new ErroDoTurno(new ErroDeStreamParado('teto', DURACAO_MAXIMA_DO_TURNO_MS).message, { cause: erro });
    throw new ErroDoTurno('A conexão com o servidor caiu no meio do turno.', { cause: erro });
  } finally {
    vigia.soltar();
  }
  throw new ErroDoTurno('O stream do Hermes fechou antes do fim do turno.');
}
