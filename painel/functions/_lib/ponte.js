// Rotas /api/frank/*: o painel fala com o Frank, que é o perfil frank do Hermes.
import { ErroHttp, lerCorpoJson, responderJson } from './http.js';
import {
  aindaEsperaAutorizacao,
  chamarHermes,
  corpoDoRun,
  exigirHermes,
  iniciarRun,
  lerQuadrosSse,
  lerResultadoDoFilho,
  lerStatusDoRun,
  listarModelos,
  MOTIVO_SEM_AUTORIZACAO,
  normalizarEvento,
  resolverCerebro,
  responderAprovacao,
} from './hermes.js';
import {
  acharDemandaDoRun,
  alterarDemanda,
  gravarDemanda,
  lerDemanda,
  listarDemandas,
  marcarDecisao,
  novaDemanda,
  tituloDoPedido,
} from './demandas.js';
import { TEXTO_DO_EMPURRAO, precisaDeEmpurrao } from './empurrao.js';
import { anotarDecisao, anotarPedido, decisaoPorVoz, pedidoPendente } from './autorizacao.js';
import { cumprimentoDoMomento, fusoValido, instrucoesDoTurno, momentoDaConversa, nomeDoDono } from './frank.js';
import { anotarDecisaoDoQuadro } from './quadro.js';

const LIMITE_DO_TEXTO = 4000;
const LIMITE_DA_SAUDACAO = 500;
const LIMITE_DO_TITULO = 80;
const FALAS_ENVIADAS = 40;
// Duração do turno: sem teto curto, porque um turno soma até 30 minutos de assistente e 5 de
// espera de autorização. O teto final é o agent.gateway_timeout do Hermes principal.
const KEEPALIVE_DO_PAINEL_MS = 20_000;
const LIMITE_SEM_QUADRO_MS = 5 * 60_000;
const TETO_DO_TURNO_MS = 2 * 60 * 60_000;
const RUN_ATIVO = new Set(['running', 'waiting_for_approval']);
const LIMITE_DO_RESUMO = 160;
const FALA_NO_LOG = 120;
const ID_DO_RUN = /^[A-Za-z0-9_-]{1,100}$/;
const MOTIVO_STREAM_CAIU = 'A conexão com o Hermes caiu antes do fim do turno. Tenta de novo?';
const MOTIVO_ESPERANDO_AUTORIZACAO = 'O Frank está esperando a sua autorização. Responda sim ou não.';
const MOTIVO_HERMES_PAROU = 'O Hermes ficou 5 minutos sem mandar nada e o turno não está mais rodando lá. Tenta de novo?';
const MOTIVO_TETO_DO_TURNO = 'O turno passou de 2 horas sem terminar. Tenta de novo?';

// O SOUL definitivo só põe o caminho da entrega em "Ajustar:" quando ele aparece na conversa.
function comArquivo(texto, arquivo) {
  return `${/[.!?…]$/u.test(texto) ? texto : `${texto}.`} Arquivo: ${arquivo}`;
}

function textoOpcional(valor, campo, limite) {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor !== 'string' || valor.trim().length > limite) throw new ErroHttp(400, `${campo} precisa ser texto com até ${limite} caracteres.`);
  return valor.trim() || undefined;
}

// O dono tirou a entrega da bandeja: ela não segue, mas o arquivo é dele e apagar continua pedindo autorização.
export const INSTRUCAO_DO_DESCARTE = 'Descartar é não usar mais essa entrega: anote no registro de decisões, não apague nem mexa no arquivo e responda numa frase curta.';

// padrao: o modelo que o perfil frank do Hermes usa quando o painel não escolhe outro; null com o Hermes fora do ar.
export async function estadoDoCerebro(env, fetchFn = fetch) {
  try {
    const { padrao } = await listarModelos(env, fetchFn, { timeoutMs: 3000 });
    return { disponivel: true, motivo: null, via: 'hermes', padrao };
  } catch (erro) {
    if (erro instanceof ErroHttp) return { disponivel: false, motivo: erro.message, via: 'hermes', padrao: null };
    throw erro;
  }
}

export async function responderModelos(env, fetchFn = fetch) {
  return responderJson(200, await listarModelos(env, fetchFn));
}

export async function iniciarTurno(request, env, fetchFn = fetch) {
  const hermes = exigirHermes(env);
  const corpo = await lerCorpoJson(request);
  const texto = typeof corpo.texto === 'string' ? corpo.texto.trim() : '';
  if (texto.length === 0 || texto.length > LIMITE_DO_TEXTO) throw new ErroHttp(400, `texto precisa ter entre 1 e ${LIMITE_DO_TEXTO} caracteres.`);
  const saudacao = textoOpcional(corpo.saudacao, 'saudacao', LIMITE_DA_SAUDACAO);
  if (corpo.demandaId !== undefined && typeof corpo.demandaId !== 'string') throw new ErroHttp(400, 'demandaId precisa ser texto.');
  // Sem cérebro escolhido no painel, o turno nem consulta a lista de modelos: vai ao Hermes sem model e sem provider.
  const cerebro = corpo.cerebro === undefined || corpo.cerebro === null ? null : resolverCerebro(corpo.cerebro, await listarModelos(env, fetchFn));
  const fuso = fusoValido(corpo.fuso);

  const comecar = async (demanda) => {
    const decisao = marcarDecisao(demanda, texto);
    // Decidir entrega com arquivo leva o caminho no texto do turno, que vai ao Hermes e ao histórico.
    const textoDoTurno = decisao?.entrega.arquivo ? comArquivo(texto, decisao.entrega.arquivo) : texto;
    const input = decisao?.tipo === 'ajuste' ? `${textoDoTurno}\n\nTexto atual da entrega:\n${decisao.entrega.texto}`
      : decisao?.tipo === 'descarte' ? `${textoDoTurno}\n\n${INSTRUCAO_DO_DESCARTE}` : textoDoTurno;
    const iniciadoEm = new Date().toISOString();
    const runId = await iniciarRun(fetchFn, hermes, corpoDoRun({ input, historico: demanda.historico.slice(-FALAS_ENVIADAS), cerebro, instrucoes: instrucoesDoRun(fuso) }));
    // entrada: o que o Hermes recebeu, quando difere do texto do turno (ajuste leva o texto atual da entrega).
    // O empurrão reenvia a entrada; o histórico guarda só o texto do turno.
    demanda.runs.push({ runId, texto: textoDoTurno, ...(input === textoDoTurno ? {} : { entrada: input }), cerebro, fuso, iniciadoEm, status: 'rodando' });
    demanda.titulo ??= tituloDoPedido(texto);
    demanda.cerebro = cerebro;
    demanda.atualizadaEm = iniciadoEm;
    return { demandaId: demanda.id, runId };
  };

  if (corpo.demandaId) {
    const { status, resposta } = await alterarDemanda(env, corpo.demandaId, async (demanda) => {
      const pendente = pedidoPendente(demanda);
      if (!pendente && corpo.aprovacao && decisaoPorVoz(texto)) return { status: 409, resposta: { erro: MOTIVO_SEM_AUTORIZACAO } };
      const porVoz = pendente && (await responderPorVoz(fetchFn, hermes, demanda, pendente, texto, corpo.aprovacao));
      return porVoz ?? { status: 200, resposta: await comecar(demanda) };
    });
    if (resposta?.runId) await anotarDecisaoNoQuadro(env, texto);
    return responderJson(status, resposta);
  }
  // Demanda nova só vai ao disco se o Hermes aceitar o turno: falha no POST não deixa demanda órfã.
  const demanda = novaDemanda({ saudacao, cerebro, nome: nomeDoDono(env) });
  const resposta = await comecar(demanda);
  await gravarDemanda(env, demanda);
  await anotarDecisaoNoQuadro(env, texto);
  return responderJson(200, resposta);
}

// Decisão sobre entrega do quadro Kanban, já aceita pelo Hermes: a entrega sai da bandeja. Falha ao gravar não derruba o turno.
async function anotarDecisaoNoQuadro(env, texto) {
  try {
    await anotarDecisaoDoQuadro(env, texto);
  } catch (erro) {
    console.warn('[frank] não deu para anotar a decisão da entrega do quadro.', erro);
  }
}

// Autorização por voz: com pedido pendente na demanda, o turno não abre run novo. null = o Hermes já não espera
// (reiniciou, ou o timeout passou sem relay aberto) e o texto segue como turno normal.
async function responderPorVoz(fetchFn, hermes, demanda, { run, pedido }, texto, esperado) {
  const decisao = decisaoPorVoz(texto);
  if (!decisao || !pedido.requestId || esperado?.requestId !== pedido.requestId || esperado?.runId !== run.runId) {
    if (!(await aindaEsperaAutorizacao(fetchFn, hermes, pedido))) {
      anotarDecisao(run, pedido, 'expirou');
      return esperado && decisao ? { status: 409, resposta: { erro: MOTIVO_SEM_AUTORIZACAO } } : null;
    }
    // runId é o do turno, o mesmo do SSE e da rota de aprovação: com ele o painel refaz o cartão depois de recarregar.
    const aprovacaoPendente = { comando: pedido.comando, descricao: pedido.descricao, runId: run.runId, requestId: pedido.requestId };
    return { status: 409, resposta: { erro: MOTIVO_ESPERANDO_AUTORIZACAO, aprovacaoPendente } };
  }
  try {
    await responderAprovacao(fetchFn, hermes, { runId: pedido.runId, requestId: pedido.requestId, decisao });
  } catch (erro) {
    if (!(erro instanceof ErroHttp && erro.status === 409)) throw erro;
    // O Hermes não espera mais: a pendência sai da demanda para o próximo turno não ficar preso nela.
    anotarDecisao(run, pedido, 'expirou');
    return { status: 409, resposta: { erro: erro.message } };
  }
  anotarDecisao(run, pedido, decisao);
  return { status: 200, resposta: { demandaId: demanda.id, runId: run.runId, requestId: pedido.requestId, aprovacao: decisao } };
}

function anotarDecisaoNaDemanda(env, demandaId, runId, alvo, decisao) {
  return alterarDemanda(env, demandaId, (demanda) => {
    const run = demanda.runs.find((item) => item.runId === runId);
    if (run) anotarDecisao(run, alvo, decisao);
  });
}

// Uma decisão pertence ao pedido que o operador viu. A fila impede cliques concorrentes de responder duas vezes.
export async function decidirAprovacao(request, env, runId, fetchFn = fetch) {
  const hermes = exigirHermes(env);
  if (typeof runId !== 'string' || !ID_DO_RUN.test(runId)) throw new ErroHttp(404, 'Turno não encontrado.');
  const { decisao, requestId } = await lerCorpoJson(request);
  if (decisao !== 'sim' && decisao !== 'nao') throw new ErroHttp(400, "decisao precisa ser 'sim' ou 'nao'.");
  const demanda = await acharDemandaDoRun(env, runId);
  if (!demanda) throw new ErroHttp(404, 'Turno não encontrado.');
  // Defesa Anti-IDOR: Validação composta de posse do recurso
  const donoEsperado = nomeDoDono(env);
  if (donoEsperado && demanda.nome && demanda.nome !== donoEsperado) {
    throw new ErroHttp(403, 'Acesso negado: turno pertence a outra organização (IDOR Protection).');
  }
  // Sem identidade não há fallback para o último pedido: clientes antigos devem atualizar o painel.
  if (typeof requestId !== 'string' || !requestId.trim()) throw new ErroHttp(409, MOTIVO_SEM_AUTORIZACAO);
  const erro = await alterarDemanda(env, demanda.id, async (atual) => {
    const run = atual.runs.find((item) => item.runId === runId);
    const pedido = run?.aprovacoes?.find((item) => item.requestId === requestId);
    if (!pedido || pedido.decisao !== null || run.status !== 'rodando') return new ErroHttp(409, MOTIVO_SEM_AUTORIZACAO);
    try {
      await responderAprovacao(fetchFn, hermes, { runId: pedido.runId, requestId, decisao });
      anotarDecisao(run, pedido, decisao);
    } catch (falha) {
      if (!(falha instanceof ErroHttp && falha.status === 409)) throw falha;
      anotarDecisao(run, pedido, 'expirou');
      return falha;
    }
    return null;
  });
  if (erro) throw erro;
  return responderJson(200, { ok: true });
}

export async function responderDemandas(env) {
  exigirHermes(env);
  return responderJson(200, await listarDemandas(env));
}

export async function criarDemanda(request, env) {
  exigirHermes(env);
  const corpo = await lerCorpoJson(request);
  const titulo = textoOpcional(corpo.titulo, 'titulo', LIMITE_DO_TITULO);
  const saudacao = textoOpcional(corpo.saudacao, 'saudacao', LIMITE_DA_SAUDACAO);
  return responderJson(201, await gravarDemanda(env, novaDemanda({ titulo, saudacao, nome: nomeDoDono(env) })));
}

export async function responderDemanda(env, id) {
  exigirHermes(env);
  const demanda = await lerDemanda(env, id);
  // Defesa Anti-IDOR: Validação composta de posse do recurso
  const donoEsperado = nomeDoDono(env);
  if (donoEsperado && demanda.nome && demanda.nome !== donoEsperado) {
    throw new ErroHttp(403, 'Acesso negado: demanda pertence a outra organização (IDOR Protection).');
  }
  return responderJson(200, demanda);
}

function registrarEntrega(env, demandaId, runId, evento) {
  return alterarDemanda(env, demandaId, (demanda) => {
    if (demanda.entregas.some((entrega) => entrega.subagenteId === evento.subagenteId)) return;
    const criadaEm = new Date().toISOString();
    demanda.entregas.push({
      id: `e-${evento.subagenteId}`,
      agente: evento.agente,
      ...evento.entrega,
      status: 'pendente',
      duracaoS: evento.duracaoS,
      criadaEm,
      runId,
      subagenteId: evento.subagenteId,
    });
    demanda.atualizadaEm = criadaEm;
  });
}

function registrarFim(env, demandaId, runId, evento) {
  return alterarDemanda(env, demandaId, (demanda) => {
    const run = demanda.runs.find((item) => item.runId === runId);
    if (!run || run.status === 'concluido') return;
    const concluidoEm = new Date().toISOString();
    Object.assign(run, { status: 'concluido', concluidoEm, fala: evento.fala, provedor: evento.provedor, modelo: evento.modelo, duracaoS: evento.duracaoS });
    demanda.historico.push({ role: 'user', content: run.texto });
    if (evento.fala) demanda.historico.push({ role: 'assistant', content: evento.fala });
    demanda.atualizadaEm = concluidoEm;
  });
}

function registrarErro(env, demandaId, runId, mensagem) {
  return alterarDemanda(env, demandaId, (demanda) => {
    const run = demanda.runs.find((item) => item.runId === runId);
    if (!run || run.status !== 'rodando') return;
    Object.assign(run, { status: 'erro', erro: mensagem, concluidoEm: new Date().toISOString() });
  });
}

// O único empurrão do turno é reivindicado na fila da demanda: dois relays do mesmo run nunca empurram duas vezes.
// Devolve o histórico e o cérebro do segundo run, ou null se o turno já terminou ou já foi empurrado.
function instrucoesDoRun(fuso) {
  return instrucoesDoTurno({ momento: momentoDaConversa({ fuso, precisao: 'hora' }), cumprimento: cumprimentoDoMomento({ fuso }) });
}

function reivindicarEmpurrao(env, demandaId, runId, falaPrometida) {
  return alterarDemanda(env, demandaId, (demanda) => {
    const run = demanda.runs.find((item) => item.runId === runId);
    if (!run || run.status !== 'rodando' || run.empurrao) return null;
    run.empurrao = { status: 'pedindo', falaPrometida, pedidoEm: new Date().toISOString() };
    return {
      historico: [
        ...demanda.historico.slice(-FALAS_ENVIADAS),
        { role: 'user', content: run.entrada ?? run.texto },
        { role: 'assistant', content: falaPrometida },
      ],
      cerebro: run.cerebro,
      fuso: run.fuso,
    };
  });
}

function marcarEmpurrao(env, demandaId, runId, dados) {
  return alterarDemanda(env, demandaId, (demanda) => {
    const run = demanda.runs.find((item) => item.runId === runId);
    if (run?.empurrao) Object.assign(run.empurrao, dados);
  });
}

const codificador = new TextEncoder();

// O relay lê o Hermes até o evento terminal mesmo se o painel desconectar: histórico e entregas do turno
// são gravados de qualquer jeito. Reabrir o mesmo run repete o backlog do Hermes; a gravação ignora repetidos.
export async function abrirEventos(env, runId, fetchFn = fetch) {
  const hermes = exigirHermes(env);
  if (typeof runId !== 'string' || !ID_DO_RUN.test(runId)) throw new ErroHttp(404, 'Turno não encontrado.');
  const demanda = await acharDemandaDoRun(env, runId);
  if (!demanda) throw new ErroHttp(404, 'Turno não encontrado.');
  // Defesa Anti-IDOR: Validação composta de posse do recurso
  const donoEsperado = nomeDoDono(env);
  if (donoEsperado && demanda.nome && demanda.nome !== donoEsperado) {
    throw new ErroHttp(403, 'Acesso negado: turno pertence a outra organização (IDOR Protection).');
  }
  const { iniciadoEm } = demanda.runs.find((run) => run.runId === runId);

  let painel = null;
  const escrever = (texto) => {
    if (!painel) return;
    try {
      painel.enqueue(codificador.encode(texto));
    } catch {
      painel = null;
    }
  };
  const enviar = (evento) => escrever(`data: ${JSON.stringify(evento)}\n\n`);

  // Corte do relay: teto do turno ou Hermes parado. O primeiro motivo vale e vira o erro do painel.
  const abortar = new AbortController();
  let motivoDoCorte = null;
  const cortar = (motivo) => {
    motivoDoCorte ??= motivo;
    abortar.abort();
  };

  // null = o run ainda roda no Hermes e o relay segue. Sem resposta do status, vale a mensagem do Hermes fora do ar.
  async function motivoParaDesistir(idDoRun) {
    try {
      return RUN_ATIVO.has((await lerStatusDoRun(fetchFn, hermes, idDoRun))?.status) ? null : MOTIVO_HERMES_PAROU;
    } catch (erro) {
      return erro instanceof ErroHttp ? erro.message : MOTIVO_HERMES_PAROU;
    }
  }

  const anotarNaDemanda = (alvo, decisao) => anotarDecisaoNaDemanda(env, demanda.id, runId, alvo, decisao);

  // approval.request só vai ao painel se o Hermes ainda espera: reconectar repete o backlog, e pedido já decidido na
  // demanda nunca volta. O pedido é anotado antes de aparecer, para a rota e a voz acharem o alvo.
  async function receberPedido(idDoRun, bruto, evento) {
    const requestId = typeof bruto.request_id === 'string' && bruto.request_id ? bruto.request_id : null;
    if (!(await aindaEsperaAutorizacao(fetchFn, hermes, { runId: idDoRun, requestId }))) return null;
    return alterarDemanda(env, demanda.id, (atual) => {
      const run = atual.runs.find((item) => item.runId === runId);
      if (!run) return null;
      const pedido = anotarPedido(run, { requestId, runId: idDoRun, comando: evento.comando, descricao: evento.descricao });
      return pedido.decisao === null ? { requestId, runId: idDoRun } : null;
    });
  }

  // Repassa ao painel os eventos de um run do Hermes e devolve o terminal (fim ou erro) para quem chamou decidir.
  // terminal null = o stream acabou sem ele. usouFerramenta = o run teve algum tool.started.
  async function acompanhar(idDoRun, signal) {
    const resposta = await chamarHermes(fetchFn, hermes, `/v1/runs/${idDoRun}/events`, {
      acao: 'acompanhar o turno do Frank',
      aceitar: 'text/event-stream',
      signal,
    });
    let usouFerramenta = false;
    let delegando = false;
    // Pedidos que este painel recebeu e que ainda não fecharam. doAssistente: pedido feito com delegate_task aberto.
    const mostrados = [];
    const fechar = async (pedido, decisao) => {
      mostrados.splice(mostrados.indexOf(pedido), 1);
      await anotarNaDemanda(pedido, decisao);
      enviar({ tipo: 'aprovacao_fim', decisao, requestId: pedido.requestId });
    };
    // Hermes parado: 5 minutos sem quadro de dados. O keepalive do Hermes não conta, porque sai a cada 10 s enquanto
    // a conexão vive, ande o run ou não (api_server_runs.py:1133). Antes de desistir, o status diz se o turno roda.
    let vigia = null;
    let geracao = 0;
    const vigiar = () => {
      clearTimeout(vigia);
      const minha = ++geracao;
      vigia = setTimeout(async () => {
        const motivo = await motivoParaDesistir(idDoRun);
        // Chegou quadro durante a consulta, ou o run já terminou: esta conferência perdeu a validade.
        if (minha !== geracao || signal.aborted) return;
        if (motivo) cortar(motivo);
        else vigiar();
      }, LIMITE_SEM_QUADRO_MS);
      vigia.unref?.();
    };
    vigiar();
    try {
      for await (const quadro of lerQuadrosSse(resposta.body)) {
        if (quadro.comentario !== undefined) {
          if (quadro.comentario === 'stream closed') break;
          continue;
        }
        vigiar();
        let bruto;
        try {
          bruto = JSON.parse(quadro.dados);
        } catch {
          continue;
        }
        if (bruto?.event === 'tool.started') {
          usouFerramenta = true;
          if (bruto.tool === 'delegate_task') delegando = true;
        }
        if (bruto?.event === 'subagent.complete' && bruto.status === 'completed') {
          const inteiro = await lerResultadoDoFilho(fetchFn, hermes, bruto.child_session_id);
          if (inteiro) bruto = { ...bruto, summary: inteiro };
        }
        const evento = normalizarEvento(bruto, { iniciadoEm });
        if (!evento) continue;
        if (evento.tipo === 'aprovacao') {
          const pedido = await receberPedido(idDoRun, bruto, evento);
          if (pedido) {
            mostrados.push({ ...pedido, doAssistente: delegando });
            enviar({ ...evento, requestId: pedido.requestId });
          }
          continue;
        }
        if (evento.tipo === 'aprovacao_fim') {
          const alvo = { requestId: typeof bruto.request_id === 'string' && bruto.request_id ? bruto.request_id : null, runId: idDoRun };
          const pedido = alvo.requestId ? mostrados.find((item) => item.requestId === alvo.requestId) : mostrados[0];
          if (pedido) await fechar(pedido, evento.decisao);
          else await anotarNaDemanda(alvo, evento.decisao);
          continue;
        }
        // expirou: o run voltou a emitir eventos sem a resposta do dono, porque o Hermes não avisa o timeout. Pedido de
        // assistente só vence quando a delegação termina: os outros assistentes seguem emitindo enquanto ele espera.
        const fimDaDelegacao = bruto.event === 'tool.completed' && bruto.tool === 'delegate_task';
        const terminal = evento.tipo === 'fim' || evento.tipo === 'erro';
        for (const pedido of mostrados.filter((item) => !item.doAssistente || fimDaDelegacao || terminal)) await fechar(pedido, 'expirou');
        if (fimDaDelegacao) delegando = false;
        if (terminal) return { terminal: evento, usouFerramenta };
        if (evento.tipo === 'agente_fim' && evento.status === 'ok') await registrarEntrega(env, demanda.id, runId, evento);
        enviar(evento);
      }
      return { terminal: null, usouFerramenta };
    } finally {
      clearTimeout(vigia);
      geracao += 1;
    }
  }

  // Trava anti-promessa: fala que promete ação, sem ferramenta nenhuma e sem sinal de entrega, ganha um segundo run
  // na mesma demanda. No máximo um por turno; qualquer falha no segundo run devolve o fim original.
  async function conferirPromessa(fimOriginal, usouFerramenta, signal) {
    const jaEmpurrado = (await lerDemanda(env, demanda.id)).runs.find((run) => run.runId === runId)?.empurrao;
    // Reaberto depois do empurrão: repete o segundo run em vez de pedir outro.
    let segundoRun = jaEmpurrado?.runId ?? null;
    let pedido = null;
    if (!segundoRun) {
      if (jaEmpurrado || !precisaDeEmpurrao(fimOriginal.fala, { usouFerramenta })) return fimOriginal;
      pedido = await reivindicarEmpurrao(env, demanda.id, runId, fimOriginal.fala);
      if (!pedido) return fimOriginal;
      console.log(`[frank] empurrão no turno ${runId}: ${fimOriginal.fala.slice(0, FALA_NO_LOG)}`);
    }
    enviar({ tipo: 'ferramenta', nome: 'empurrao', fase: 'inicio', resumo: fimOriginal.fala.slice(0, LIMITE_DO_RESUMO) });
    try {
      if (pedido) {
        segundoRun = await iniciarRun(fetchFn, hermes, corpoDoRun({ input: TEXTO_DO_EMPURRAO, historico: pedido.historico, cerebro: pedido.cerebro, instrucoes: instrucoesDoRun(pedido.fuso) }));
        await marcarEmpurrao(env, demanda.id, runId, { runId: segundoRun, status: 'rodando' });
      }
      const { terminal } = await acompanhar(segundoRun, signal);
      if (terminal?.tipo !== 'fim') throw new Error('O segundo run terminou sem o evento de fim.');
      if (pedido) await marcarEmpurrao(env, demanda.id, runId, { status: 'concluido' });
      return terminal;
    } catch {
      if (pedido) await marcarEmpurrao(env, demanda.id, runId, { status: 'erro' }).catch(() => {});
      return fimOriginal;
    } finally {
      enviar({ tipo: 'ferramenta', nome: 'empurrao', fase: 'fim' });
    }
  }

  async function repassar() {
    // Os timers do turno levam unref: turno parado não segura o processo; quem segura o servidor é o http.Server.
    const teto = setTimeout(() => cortar(MOTIVO_TETO_DO_TURNO), TETO_DO_TURNO_MS);
    teto.unref?.();
    let mensagem = MOTIVO_STREAM_CAIU;
    try {
      const { terminal, usouFerramenta } = await acompanhar(runId, abortar.signal);
      if (terminal?.tipo === 'fim') {
        const fim = await conferirPromessa(terminal, usouFerramenta, abortar.signal);
        await registrarFim(env, demanda.id, runId, fim);
        enviar(fim);
        return;
      }
      if (terminal?.tipo === 'erro') mensagem = terminal.mensagem;
    } catch (erro) {
      if (erro instanceof ErroHttp) mensagem = erro.message;
    } finally {
      clearTimeout(teto);
      abortar.abort();
    }
    mensagem = motivoDoCorte ?? mensagem;
    await registrarErro(env, demanda.id, runId, mensagem).catch(() => {});
    enviar({ tipo: 'erro', mensagem });
  }

  // O painel recebe keepalive da ponte a cada 20 s, venha ou não keepalive do Hermes: é o que mantém o stream vivo
  // enquanto a ponte espera o Hermes, um assistente ou o status.
  let keepalive = null;
  const corpo = new ReadableStream({
    start(controlador) {
      painel = controlador;
      enviar({ tipo: 'inicio', runId, demandaId: demanda.id });
      keepalive = setInterval(() => escrever(': keepalive\n\n'), KEEPALIVE_DO_PAINEL_MS);
      keepalive.unref?.();
      repassar().finally(() => {
        clearInterval(keepalive);
        try {
          painel?.close();
        } catch {
          // O painel já tinha fechado.
        }
        painel = null;
      });
    },
    cancel() {
      painel = null;
      clearInterval(keepalive);
    },
  });
  return new Response(corpo, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
}
