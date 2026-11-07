import { AGENTES, saudacaoDoFrank } from './time.js';
import { SEM_API, criarApi } from './api.js';
import { lerPreferencias, salvarPreferencias } from './preferencias.js';
import { audioLiberado, contextoDeAudio, mensagemDoMicrofone } from './audio.js';
import { criarHud } from './hud.js';
import { criarBandeja, criarLegendas, criarRegistro, criarSeletorDeDemandas, formatarCusto, iniciarRelogio, montarCartaoDeAutorizacao, montarCartoes } from './painel.js';
import { abrirAjuda, criarConfiguracoes, criarPedidoDeCodigo } from './configuracoes.js';
import { criarMotorGptLive } from './motor-gpt-live.js';
import { criarMotorGeminiLive } from './motor-gemini-live.js';
import { criarEscutaDoChamado, reconhecimentoDoNavegador } from './escuta.js';
import {
  aberturaDaSessao,
  acompanharTurno,
  cerebroDoPedido,
  cerebroEmUso,
  criarAutorizacoes,
  criarAvisosDaVoz,
  criarQuadroDoTime,
  custoDoCerebro,
  destinoDoAviso,
  nomeDe,
  normalizarEvento,
  pedidoDoConflito,
  pendentesDaDemanda,
  registroDaAutorizacaoPendente,
  rodarTurno,
  rotuloDoCerebro,
  textoDaEspera,
  textoDeAjuste,
  textoDeAprovar,
  textoDeDescartar,
  textoDoAnuncioDeAutorizacao,
  textoDoAvisoDeEntregas,
  textoDoErroComVozDormindo,
  textoDoPedidoDeAutorizacao,
  textoDaAtividade,
  textoDoSonoDaVoz,
  vozDeveDormir,
} from './painel-logica.js';

const SILENCIO_ANTES_DO_AVISO_MS = 1500;
// Com a aba visível, o painel pergunta pelo quadro Kanban do Hermes; o servidor só chama a CLI quando o quadro mudou.
const INTERVALO_DO_QUADRO_MS = 5000;
const TEXTO_ESPERANDO_AUTORIZACAO = 'O Frank espera a sua autorização';
const DURACAO_DO_AVISO_DE_AUTORIZACAO_MS = 10_000;
const LIMITE_DO_PEDIDO_NO_REGISTRO = 140;
const LIMITE_DA_FALA_NO_REGISTRO = 220;
const ORIGENS = { voz: 'Você', painel: 'Painel', teste: 'Teste' };
// Chamado ouvido com o som ainda bloqueado: vale por um minuto, à espera do toque que libera o som.
const VALIDADE_DO_CHAMADO_MS = 60_000;
const REGISTRO_DO_DESPERTAR = {
  toque: (nome) => `Frank acordou no ${nome}.`,
  chamado: (nome) => `Frank acordou no ${nome} com o seu chamado.`,
  aviso: (nome) => `Frank acordou no ${nome} para dar um aviso.`,
};
// Os motores conversam pelo mesmo contrato (o do criarMotorGptLive) e entregam tudo ao Hermes. O Gemini Live é o
// padrão por custar menos; o GPT Live é opcional, e o seletor do topo só aparece quando os dois têm chave no servidor.
const MOTORES = Object.freeze({
  geminiLive: { nome: 'Gemini Live', criar: criarMotorGeminiLive },
  gptLive: { nome: 'GPT Live', criar: criarMotorGptLive },
});
const MOTOR_PADRAO = 'geminiLive';

const elemento = (id) => document.getElementById(id);
const corpo = document.body;
const preferenciasIniciais = lerPreferencias();

const estado = {
  preferencias: preferenciasIniciais,
  config: null,
  modelos: null,
  erroDosModelos: '',
  motor: null,
  // Id do motor da sessão aberta (geminiLive ou gptLive); a escolha nova vale a partir da próxima.
  motorEmUso: null,
  motorDoCusto: null,
  sessao: 'espera',
  mudo: false,
  frankFalando: false,
  ultimaVozDoUsuario: 0,
  ultimaVozDoFrank: 0,
  ultimoFimDeTurno: 0,
  // Permissão do microfone já dada: sem ela, a escuta do chamado não começa (a página não pede o microfone sozinha).
  microfoneLiberado: false,
  chamadoPendente: null,
  exigeCodigo: false,
  alertaNaTela: '',
  estadoDoTime: null,
  simulandoDespertar: false,
  // O efeito do núcleo e do time acende no primeiro despertar e não apaga mais com o sono da voz: a voz paga
  // dorme em 20 s e só o anel de voz fica quieto. Apagar e reacender a cada aviso repetia o despertar inteiro.
  visualAcordado: false,
  // A última coisa que o Frank ou o time começou a fazer no turno aberto ("Pesquisando na web…").
  atividade: '',
  saudacao: '',
  // A última saudação montada: a próxima sai diferente.
  ultimaSaudacao: '',
  demanda: preferenciasIniciais.demandaId ? { id: preferenciasIniciais.demandaId, titulo: null } : null,
  turnos: new Set(),
  esperaDaDemanda: null,
  prazoDoAvisoDeAutorizacao: 0,
};

const registro = criarRegistro(elemento('registro-lista'));
const legendas = criarLegendas({ frank: elemento('legenda-frank'), usuario: elemento('legenda-usuario') });
const cartoes = montarCartoes(elemento('time'));
const quadro = criarQuadroDoTime();
const autorizacoes = criarAutorizacoes();
// O que o Frank precisa falar e ainda não falou: espera a sessão abrir, ou a próxima vez que ela abrir, se acordar falhar.
const avisosDaVoz = criarAvisosDaVoz();
const cartaoDeAutorizacao = montarCartaoDeAutorizacao({ raiz: elemento('autorizacao'), aoResponder: responderAutorizacao });
const bandeja = criarBandeja({
  secao: elemento('bandeja'),
  lista: elemento('bandeja-lista'),
  contagem: elemento('contagem'),
  titulo: elemento('titulo-bandeja'),
  caixa: elemento('dialogo-entrega'),
  aoDecidir: decidirPeloPainel,
});
const pedirCodigoNoDialogo = criarPedidoDeCodigo({ dialogo: elemento('dialogo-codigo'), entrada: elemento('codigo-entrada') });
const api = criarApi({
  obterCodigo: () => estado.preferencias.codigo,
  pedirCodigo: async () => {
    estado.exigeCodigo = true;
    const codigo = await pedirCodigoNoDialogo();
    if (codigo) alterarPreferencias({ codigo });
    return codigo;
  },
});
const hud = criarHud({
  palco: elemento('palco'),
  area: elemento('nucleo-area'),
  canvas: elemento('hud'),
  cartoes: () => cartoes.elementos,
  obterNiveis,
  obterQuadro,
  aoAcender: (indice) => cartoes.acender(indice),
  aoApagar: () => cartoes.apagarTodos(),
});
// null quando o navegador não tem o reconhecimento de fala (fora do Chrome): sobram o toque, o Espaço e os avisos.
const criarReconhecimento = reconhecimentoDoNavegador(window);
const configuracoes = criarConfiguracoes({
  dialogo: elemento('dialogo-config'),
  obterPreferencias: () => estado.preferencias,
  alterarPreferencias,
  obterConfig: () => estado.config,
  obterModelos: () => ({ dados: estado.modelos, erro: estado.erroDosModelos }),
  recarregarModelos: carregarModelos,
  obterSessaoAtiva: () => estado.sessao !== 'espera',
  exigeCodigo: () => estado.exigeCodigo,
  obterEscuta: () => {
    if (!criarReconhecimento) return 'indisponivel';
    return estado.microfoneLiberado ? escuta.estado() : 'sem-microfone';
  },
});
const escuta = criarEscutaDoChamado({
  criarReconhecimento,
  aoChamar: acordarPeloChamado,
  aoMudar: () => {
    atualizarEstadoNaTela();
    configuracoes.atualizarEscuta();
  },
});
const seletorDeDemandas = criarSeletorDeDemandas({
  botao: elemento('demanda-botao'),
  titulo: elemento('demanda-titulo'),
  painel: elemento('demandas'),
  lista: elemento('demandas-lista'),
  nota: elemento('demandas-nota'),
  nova: elemento('demanda-nova'),
  carregar: carregarDemandas,
  aoEscolher: retomarDemanda,
  aoNova: novaDemanda,
});

function anunciar(texto) {
  elemento('anuncio').textContent = texto;
}

function cortar(texto, limite) {
  const limpo = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1).trimEnd()}…` : limpo;
}

function renderizarTime() {
  estado.estadoDoTime = quadro.estado();
  cartoes.atualizar(estado.estadoDoTime);
  bandeja.atualizar(estado.estadoDoTime.pendentes);
}

function executarEfeitos(efeitos, turno) {
  for (const efeito of efeitos) {
    if (efeito.tipo === 'pulso') {
      const indice = AGENTES.findIndex((agente) => agente.id === efeito.agente);
      if (indice >= 0) hud.pulsar(indice, efeito.sentido);
    } else if (efeito.tipo === 'nucleo') {
      hud.destacarNucleo();
    } else if (efeito.tipo === 'registro') {
      registro.adicionar(efeito.texto, efeito.nivel);
    } else if (efeito.tipo === 'anuncio') {
      anunciar(efeito.texto);
    } else if (efeito.tipo === 'entrega' && efeito.naBandeja) {
      turno?.entregas.push(efeito.pendente);
    }
  }
}

function autorizacaoAberta() {
  return autorizacoes.estado().fase === 'aberto';
}

function renderizarAutorizacao() {
  cartaoDeAutorizacao.mostrar(autorizacoes.estado());
  atualizarEstadoNaTela();
}

function registrarLinha(linha) {
  if (linha) registro.adicionar(linha.texto, linha.nivel);
}

// `aprovacao` no turno: o Hermes pausou um comando destrutivo. Cartão na tela e, com a voz ligada, o Frank pede o sim ou o não.
function abrirAutorizacao(evento, turno, { pedirPorVoz = true, comLinhaNoRegistro = true } = {}) {
  const aberto = autorizacoes.abrir(evento, { runId: turno.runId ?? '', delegacaoId: turno.delegacaoId ?? null });
  if (!aberto.novo) return;
  clearTimeout(estado.prazoDoAvisoDeAutorizacao);
  renderizarAutorizacao();
  if (comLinhaNoRegistro) registrarLinha(aberto.registro);
  anunciar(textoDoAnuncioDeAutorizacao(aberto.pedido));
  hud.destacarNucleo();
  // Com a voz dormindo, o pedido acorda a sessão, e a espera automática conta do fim da fala do Frank, com o microfone aberto.
  if (pedirPorVoz) {
    avisarPelaVoz(
      { tipo: 'aprovacao', chave: chaveDaAutorizacao(aberto.pedido.runId), texto: textoDoPedidoDeAutorizacao(aberto.pedido), delegacaoId: aberto.pedido.delegacaoId },
      { podeAcordar: turno.origem !== 'teste' },
    );
  }
}

function chaveDaAutorizacao(runId) {
  return `aprovacao:${runId}`;
}

function finalizarAutorizacao(runId, decisao, requestId) {
  const fim = autorizacoes.finalizar(runId, decisao, requestId);
  if (fim.fechou) avisosDaVoz.descartar(chaveDaAutorizacao(runId));
  registrarLinha(fim.registro);
  if (fim.aviso) {
    anunciar(fim.aviso);
    clearTimeout(estado.prazoDoAvisoDeAutorizacao);
    estado.prazoDoAvisoDeAutorizacao = setTimeout(() => {
      if (autorizacoes.dispensarAviso()) renderizarAutorizacao();
    }, DURACAO_DO_AVISO_DE_AUTORIZACAO_MS);
  }
  renderizarAutorizacao();
}

// O servidor aceitou a resposta, pelo botão ou pela voz.
function confirmarAutorizacao(runId, decisao, requestId) {
  const confirmado = autorizacoes.confirmar(runId, decisao, requestId);
  if (confirmado.fechou) avisosDaVoz.descartar(chaveDaAutorizacao(runId));
  registrarLinha(confirmado.registro);
  if (confirmado.fechou) anunciar(decisao === 'sim' ? 'Autorizado. O Frank segue com o comando.' : 'Não autorizado. O comando não vai rodar.');
  renderizarAutorizacao();
}

async function responderAutorizacao(runId, decisao, requestId) {
  if (!autorizacoes.enviar(runId, decisao, requestId)) return;
  renderizarAutorizacao();
  try {
    await api.json(`/api/frank/turno/${encodeURIComponent(runId)}/aprovacao`, { metodo: 'POST', corpo: { decisao, requestId }, timeoutMs: 15_000 });
    confirmarAutorizacao(runId, decisao, requestId);
  } catch (erro) {
    // 409: a voz ou o prazo já resolveram o pedido. Fecha sem aviso; o aprovacao_fim do turno registra o desfecho.
    if (erro?.status === 409) {
      if (autorizacoes.descartar(runId, requestId)) avisosDaVoz.descartar(chaveDaAutorizacao(runId));
      sincronizarDemanda();
    } else {
      autorizacoes.falhouEnvio(runId, `A resposta não chegou ao Frank. ${erro?.message ?? ''}`, requestId);
      registro.adicionar(`A resposta à autorização não chegou ao Frank: ${erro?.message ?? erro}`, 'erro');
    }
    renderizarAutorizacao();
  }
}

// A fala ou o clique não respondeu ao pedido de pé: ele continua na tela. Por voz, quem repete o pedido é o motor.
// Com o runId no 409 (aba recarregada no meio da espera), o cartão volta e o clique funciona; sem ele, só a voz responde.
function avisarAutorizacaoPendente(pendente) {
  const conflito = pedidoDoConflito(pendente);
  if (conflito) abrirAutorizacao(conflito.evento, { runId: conflito.runId, delegacaoId: null }, { pedirPorVoz: false, comLinhaNoRegistro: false });
  registrarLinha(registroDaAutorizacaoPendente(pendente));
  if (autorizacaoAberta()) cartaoDeAutorizacao.destacar();
}

function aplicarEventoDoTurno(evento, turno) {
  // Os deltas de texto do Hermes não mudam o painel: quem fala é o motor de voz, com a `fala` do fim.
  if (evento.tipo === 'texto') return;
  // O andamento é falado pela voz (narrador.js); aqui só entra no registro.
  if (evento.tipo === 'andamento') {
    registro.adicionar(`Frank: “${cortar(evento.texto, LIMITE_DA_FALA_NO_REGISTRO)}”`);
    return;
  }
  if (evento.tipo === 'aprovacao') {
    abrirAutorizacao(evento, turno);
    return;
  }
  if (evento.tipo === 'aprovacao_fim') {
    finalizarAutorizacao(turno.runId ?? '', evento.decisao, evento.requestId);
    return;
  }
  // Run encerrado não tem mais a quem responder: o pedido que ficou aberto sai da tela.
  if (evento.tipo === 'fim' || evento.tipo === 'erro') {
    avisosDaVoz.descartar(chaveDaAutorizacao(turno.runId ?? ''));
    if (autorizacoes.encerrarRun(turno.runId ?? '')) renderizarAutorizacao();
  }
  const atividade = textoDaAtividade(evento);
  if (atividade) estado.atividade = atividade;
  const ativa = !turno.demandaId || turno.demandaId === estado.demanda?.id;
  executarEfeitos(quadro.aplicar(evento, { runId: turno.runId ?? '', ativa }), turno);
  renderizarTime();
  atualizarEstadoNaTela();
}

// Algo que o Frank precisa falar: com a voz acordada sai já (ou no próximo silêncio); dormindo, acorda a sessão.
// podeAcordar falso (gatilho de teste) fala só se a voz já estiver acordada.
function avisarPelaVoz(aviso, { podeAcordar = true } = {}) {
  const destino = destinoDoAviso({ sessao: estado.sessao, podeAcordar });
  if (destino === 'ignorar') return;
  // Pedido de autorização com a sessão de pé sai na hora; antes de o canal abrir, ele espera a abertura da sessão.
  if (destino === 'falar' && aviso.tipo === 'aprovacao' && estado.motor?.conectado) {
    estado.motor.falarSobreTurno(aviso.delegacaoId ?? null, aviso.texto);
    return;
  }
  avisosDaVoz.adicionar(aviso);
  if (destino === 'acordar') acordarParaAvisar();
}

// Turno pedido por voz cuja sessão já dormiu (ou fechou): ela não fala mais, então a fala vai para o registro e acorda a voz.
function entregarFalaDaVozDormida(fala, motor) {
  if (!fala || motor === estado.motor) return;
  registro.adicionar(`Frank: “${cortar(fala, LIMITE_DA_FALA_NO_REGISTRO)}”`);
  avisarPelaVoz({ tipo: 'fim', texto: fala });
}

// Turno no Hermes (voz, clique no painel ou gatilho de teste): POST /api/frank/turno e os eventos no HUD.
// motor: a sessão de voz que delegou o turno, quando ele veio da voz.
async function executarTurno({ texto, aoEvento, origem = 'voz', delegacaoId = null, motor = null }) {
  // Dois pedidos seguidos sem demanda ativa caem na mesma demanda nova: o segundo espera o primeiro criá-la.
  if (!estado.demanda?.id && estado.esperaDaDemanda) await estado.esperaDaDemanda;
  let liberarDemanda = null;
  if (!estado.demanda?.id) estado.esperaDaDemanda = new Promise((resolver) => {
    liberarDemanda = resolver;
  });
  const soltarDemanda = () => {
    if (!liberarDemanda) return;
    liberarDemanda();
    liberarDemanda = null;
    estado.esperaDaDemanda = null;
  };

  // delegacaoId: a delegação da voz que pediu o turno, para o pedido de autorização sair no fio dela.
  const turno = { runId: null, demandaId: estado.demanda?.id ?? null, origem, delegacaoId, entregas: [], controle: new AbortController() };
  estado.turnos.add(turno);
  registro.adicionar(`${ORIGENS[origem] ?? 'Você'} para o Frank: “${cortar(texto, LIMITE_DO_PEDIDO_NO_REGISTRO)}”`);
  atualizarEstadoNaTela();
  try {
    const resultado = await rodarTurno({
      api,
      texto,
      demandaId: turno.demandaId,
      cerebro: cerebroDoPedido(estado.preferencias.cerebro, estado.modelos),
      saudacao: estado.saudacao,
      aprovacao: autorizacoes.estado().pedido,
      sinal: turno.controle.signal,
      aoAceito: ({ runId, demandaId }) => {
        turno.runId = runId;
        turno.demandaId = demandaId;
        if (demandaId && !estado.demanda?.id) {
          adotarDemanda({ id: demandaId, titulo: null });
          // O servidor já deu título à demanda nova no POST: a barra mostra sem esperar o fim do turno.
          sincronizarDemanda();
        }
        soltarDemanda();
      },
      aoEvento: (evento) => {
        aplicarEventoDoTurno(evento, turno);
        aoEvento?.(evento);
      },
    });
    // O texto era a resposta à autorização pendente: o turno que pediu segue no SSE dele, já aberto.
    if (resultado.aprovacao) confirmarAutorizacao(resultado.runId, resultado.aprovacao, resultado.requestId);
    else if (origem === 'voz') entregarFalaDaVozDormida(resultado.fim.fala, motor);
    else if (resultado.fim.fala) registro.adicionar(`Frank: “${cortar(resultado.fim.fala, LIMITE_DA_FALA_NO_REGISTRO)}”`);
    return { ...resultado, entregas: turno.entregas };
  } catch (erro) {
    if (erro && typeof erro === 'object') erro.aceito = Boolean(turno.runId);
    if (erro?.aprovacaoPendente) avisarAutorizacaoPendente(erro.aprovacaoPendente);
    else if (!turno.controle.signal.aborted && !erro?.doHermes) registro.adicionar(`O turno no Hermes falhou: ${erro?.message ?? erro}`, 'erro');
    if (origem === 'voz' && motor !== estado.motor && !erro?.aprovacaoPendente && !turno.controle.signal.aborted) {
      avisarPelaVoz({ tipo: 'erro', texto: textoDoErroComVozDormindo(texto) });
    }
    throw erro;
  } finally {
    soltarDemanda();
    estado.turnos.delete(turno);
    if (estado.turnos.size === 0) estado.atividade = '';
    estado.ultimoFimDeTurno = Date.now();
    if (turno.runId) quadro.encerrarRun(turno.runId);
    renderizarTime();
    atualizarEstadoNaTela();
    if (turno.demandaId && turno.demandaId === estado.demanda?.id) sincronizarDemanda();
  }
}

// Recarga/retorno à demanda: acompanha só o run existente. Nenhum POST é repetido.
function retomarTurno(run, demandaId) {
  if ([...estado.turnos].some((turno) => turno.runId === run.runId)) return;
  const turno = { runId: run.runId, demandaId, origem: 'retomada', delegacaoId: null, entregas: [], controle: new AbortController() };
  estado.turnos.add(turno);
  atualizarEstadoNaTela();
  acompanharTurno({
    api, runId: run.runId, demandaId, sinal: turno.controle.signal,
    aoEvento: (evento) => aplicarEventoDoTurno(evento, turno),
  }).then(({ fim }) => {
    if (fim.fala) registro.adicionar(`Frank: “${cortar(fim.fala, LIMITE_DA_FALA_NO_REGISTRO)}”`);
  }).catch((erro) => {
    if (!turno.controle.signal.aborted) registro.adicionar(`Não foi possível reconectar o turno: ${erro.message}`, 'erro');
  }).finally(() => {
    estado.turnos.delete(turno);
    quadro.encerrarRun(turno.runId);
    if (estado.turnos.size === 0) estado.atividade = '';
    renderizarTime();
    atualizarEstadoNaTela();
  });
}

// Aprovar, pedir ajuste ou descartar é um turno novo na mesma demanda, com o texto do contrato.
async function decidirPeloPainel(chave, decisao, observacao) {
  const pendente = quadro.decidir(chave);
  if (!pendente) return;
  renderizarTime();
  const nome = nomeDe(pendente.agente);
  const textos = {
    aprovar: [`Você aprovou: ${pendente.titulo} (${nome}).`, `Entrega de ${nome} aprovada. O Frank já sabe.`, () => textoDeAprovar(pendente)],
    ajustar: [`Você pediu ajuste a ${nome}: ${pendente.titulo}.`, `Ajuste pedido a ${nome}. O Frank já sabe.`, () => textoDeAjuste(pendente, observacao)],
    descartar: [`Você descartou: ${pendente.titulo} (${nome}).`, `Entrega de ${nome} descartada. O Frank já sabe.`, () => textoDeDescartar(pendente)],
  };
  const [linha, aviso, texto] = textos[decisao] ?? textos.ajustar;
  registro.adicionar(linha);
  anunciar(aviso);
  try {
    const resultado = await executarTurno({ texto: texto(), origem: 'painel' });
    if (resultado.fim?.fala) avisarPelaVoz({ tipo: 'fim', texto: resultado.fim.fala });
  } catch (erro) {
    if (erro?.aceito) return;
    quadro.desfazerDecisao(pendente);
    renderizarTime();
    if (erro?.aprovacaoPendente) {
      registro.adicionar(`A entrega de ${nome} voltou para a bandeja: antes, responda a autorização que o Frank pediu.`);
      anunciar('Antes de decidir a entrega, responda a autorização que o Frank pediu.');
      return;
    }
    registro.adicionar(`A decisão não chegou ao Frank; a entrega de ${nome} voltou para a bandeja.`, 'erro');
  }
}

// Delegação velha: a fala dela foi descartada, então as entregas que ela trouxe viram aviso ao Frank.
function avisarEntregasDescartadas(resultado) {
  const abertas = new Set(quadro.estado().pendentes.map((pendente) => pendente.chave));
  const entregas = (resultado?.entregas ?? []).filter((pendente) => abertas.has(pendente.chave));
  registro.adicionar('Resposta de um pedido anterior descartada: o Frank já estava num pedido mais novo.');
  if (entregas.length > 0) avisarPelaVoz({ tipo: 'fim', texto: textoDoAvisoDeEntregas(entregas) });
}

function adotarDemanda(demanda) {
  estado.demanda = demanda?.id ? { id: demanda.id, titulo: demanda.titulo ?? null } : null;
  const id = estado.demanda?.id ?? null;
  if (estado.preferencias.demandaId !== id) alterarPreferencias({ demandaId: id });
  seletorDeDemandas.definir(estado.demanda);
}

async function carregarDemandas() {
  const lista = await api.json('/api/frank/demandas', { timeoutMs: 8000 });
  return Array.isArray(lista) ? lista.filter((item) => item && typeof item.id === 'string') : [];
}

function retomarDemanda(resumo) {
  adotarDemanda({ id: resumo.id, titulo: resumo.titulo });
  quadro.limparPendentes();
  renderizarTime();
  registro.adicionar(`Demanda retomada: ${resumo.titulo || 'Nova demanda'}.`);
  anunciar(`Demanda ativa: ${resumo.titulo || 'Nova demanda'}.`);
  sincronizarDemanda();
}

function novaDemanda() {
  if (!estado.demanda) {
    anunciar('O próximo pedido ao Frank já abre uma demanda nova.');
    return;
  }
  adotarDemanda(null);
  quadro.limparPendentes();
  renderizarTime();
  registro.adicionar('Nova demanda: o próximo pedido ao Frank abre uma.');
  anunciar('Nova demanda. O próximo pedido ao Frank abre uma.');
}

// O arquivo da demanda no servidor é a fonte das entregas pendentes; o stream só adianta o que já chegou.
async function sincronizarDemanda({ silencioso = false } = {}) {
  const id = estado.demanda?.id;
  if (!id) return;
  try {
    const demanda = await api.json(`/api/frank/demandas/${encodeURIComponent(id)}`, { timeoutMs: 8000 });
    if (estado.demanda?.id !== id) return;
    if (demanda?.titulo && demanda.titulo !== estado.demanda.titulo) {
      estado.demanda.titulo = demanda.titulo;
      seletorDeDemandas.definir(estado.demanda);
    }
    const manterRuns = new Set([...estado.turnos].map((turno) => turno.runId).filter(Boolean));
    quadro.carregarPendentes(pendentesDaDemanda(demanda), { manterRuns });
    for (const run of demanda.runs ?? []) {
      if (run.status !== 'rodando') continue;
      for (const pedido of run.aprovacoes ?? []) {
        if (pedido.decisao === null && pedido.requestId) abrirAutorizacao({ ...pedido, tipo: 'aprovacao' }, { runId: run.runId, origem: 'retomada' });
      }
      retomarTurno(run, demanda.id);
    }
    renderizarTime();
  } catch (erro) {
    if (estado.demanda?.id !== id) return;
    if (erro?.status === 404 && erro.message !== SEM_API) {
      registro.adicionar('A demanda salva não existe mais no servidor; o próximo pedido abre uma nova.', 'erro');
      adotarDemanda(null);
      quadro.limparPendentes();
      renderizarTime();
      return;
    }
    if (!silencioso) registro.adicionar(`Não deu para ler a demanda: ${erro?.message ?? erro}`, 'erro');
  }
}

// Cartões e entregas pelo quadro Kanban, além do delegate_task dos turnos. Sem o quadro no servidor, nada muda.
let lendoOQuadro = false;
async function lerQuadroKanban() {
  if (lendoOQuadro || document.hidden) return;
  lendoOQuadro = true;
  try {
    const resumo = await api.json('/api/frank/quadro', { timeoutMs: 20_000 });
    executarEfeitos(quadro.carregarQuadro(resumo));
    renderizarTime();
    atualizarEstadoNaTela();
  } catch (erro) {
    console.warn('Não deu para ler o quadro do Kanban agora.', erro);
  } finally {
    lendoOQuadro = false;
  }
}

async function carregarModelos() {
  try {
    const dados = await api.json('/api/frank/modelos', { timeoutMs: 8000 });
    if (!dados || !Array.isArray(dados.provedores)) throw new Error('O servidor devolveu a lista de modelos fora do formato.');
    estado.modelos = dados;
    estado.erroDosModelos = '';
  } catch (erro) {
    estado.erroDosModelos = erro.message;
  }
  atualizarEstadoNaTela();
}

function configSemServidor(motivo) {
  const indisponivel = { disponivel: false, motivo, vozes: [], vozPadrao: '' };
  return {
    motores: { geminiLive: { ...indisponivel }, gptLive: { ...indisponivel } },
    cerebro: { disponivel: false, motivo },
    dono: { nome: '', empresa: '' },
  };
}

// O motor salvo sem chave no servidor (o GPT Live é opcional) cede a vez ao outro que tiver.
function motorEscolhido() {
  const preferido = MOTORES[estado.preferencias.motor] ? estado.preferencias.motor : MOTOR_PADRAO;
  if (!estado.config || infoDaConversa(preferido).disponivel) return preferido;
  return Object.keys(MOTORES).find((id) => infoDaConversa(id).disponivel) ?? preferido;
}

// Nome que o Frank usa: o das configurações deste navegador ou, sem ele, o FRANK_NOME_DO_DONO do servidor.
function nomeDoDono() {
  return estado.preferencias.nome || estado.config?.dono?.nome || '';
}

function infoDaConversa(id = motorEscolhido()) {
  const info = estado.config?.motores?.[id];
  const pronto = Boolean(MOTORES[id]?.criar);
  return {
    id,
    nome: MOTORES[id]?.nome ?? id,
    disponivel: pronto && Boolean(info?.disponivel),
    motivo: pronto ? info?.motivo ?? null : 'A conversa por este motor ainda não está ligada no painel.',
  };
}

function vozDoGptLive() {
  const info = estado.config?.motores?.gptLive;
  if (!info) return '';
  return info.vozes?.includes(estado.preferencias.vozGptLive) ? estado.preferencias.vozGptLive : info.vozPadrao ?? '';
}

function vozDoGemini() {
  const info = estado.config?.motores?.geminiLive;
  if (!info) return '';
  return info.vozes?.some((voz) => voz.id === estado.preferencias.vozGemini) ? estado.preferencias.vozGemini : info.vozPadrao ?? '';
}

function vozDoMotor(id) {
  return id === 'geminiLive' ? vozDoGemini() : vozDoGptLive();
}

function textoDoTurno() {
  if (autorizacaoAberta()) return TEXTO_ESPERANDO_AUTORIZACAO;
  if (estado.atividade) return estado.atividade;
  return estado.estadoDoTime?.agentes.some((agente) => agente.status === 'trabalhando') ? 'O time tá trabalhando…' : 'Frank pensando…';
}

function textoDaSessaoAtiva() {
  if (estado.mudo) return 'Microfone silenciado. Espaço reativa.';
  if (estado.frankFalando) return 'Frank falando';
  if (estado.turnos.size > 0 || autorizacaoAberta()) return textoDoTurno();
  return 'Ouvindo';
}

function trabalhoAberto() {
  return estado.turnos.size > 0 || autorizacaoAberta();
}

// Acende o efeito no primeiro despertar (voz acordada ou trabalho aberto) e não apaga mais.
function sincronizarVisual() {
  if (estado.visualAcordado || !(estado.sessao === 'ativa' || trabalhoAberto())) return;
  estado.visualAcordado = true;
  hud.acordar();
}

function atualizarEstadoNaTela() {
  sincronizarVisual();
  corpo.dataset.sessao = estado.sessao;
  corpo.dataset.trabalhando = trabalhoAberto() ? 'sim' : 'nao';
  corpo.dataset.visual = estado.visualAcordado ? 'aceso' : 'apagado';
  corpo.dataset.mudo = estado.mudo ? 'sim' : 'nao';
  corpo.dataset.falando = estado.frankFalando ? 'sim' : 'nao';

  const info = estado.config ? infoDaConversa() : null;
  const cerebro = estado.config?.cerebro;
  const status = elemento('estado-frank');
  let texto;
  let alerta = false;
  // O modelo aparece quando está em uso (sessão acordada ou turno aberto), sempre com texto curto ao lado:
  // a linha não quebra, e na espera sem turno ela fica como foi aprovada.
  let mostrarCerebro = false;
  if (estado.sessao === 'conectando') {
    texto = `Conectando ao ${MOTORES[estado.motorEmUso ?? motorEscolhido()].nome}…`;
    mostrarCerebro = true;
  } else if (estado.sessao === 'ativa') {
    texto = textoDaSessaoAtiva();
    mostrarCerebro = true;
  } else if (estado.turnos.size > 0 || autorizacaoAberta()) {
    texto = textoDoTurno();
    mostrarCerebro = true;
  } else if (estado.alertaNaTela) {
    texto = estado.alertaNaTela;
    alerta = true;
  } else if (info && !info.disponivel) {
    texto = `${info.nome} indisponível. ${info.motivo ?? ''}`.trim();
    alerta = true;
  } else if (cerebro && cerebro.disponivel === false) {
    texto = `Hermes fora do ar. ${cerebro.motivo ?? ''}`.trim();
    alerta = true;
  } else {
    texto = textoDaEspera({ escutando: escuta.escutando });
  }
  elemento('estado-texto').textContent = texto;
  if (alerta) status.dataset.tipo = 'alerta';
  else if (texto === TEXTO_ESPERANDO_AUTORIZACAO) status.dataset.tipo = 'autorizacao';
  else delete status.dataset.tipo;
  const emUso = cerebroEmUso(estado.preferencias.cerebro, estado.modelos);
  const custo = custoDoCerebro(emUso, estado.modelos);
  const rotulo = mostrarCerebro ? rotuloDoCerebro(emUso) : '';
  const etiqueta = elemento('estado-cerebro');
  etiqueta.textContent = rotulo;
  etiqueta.title = custo.titulo;
  etiqueta.hidden = !rotulo;
  const tipoDoCusto = elemento('custo-tipo');
  tipoDoCusto.textContent = custo.rotulo;
  tipoDoCusto.title = custo.titulo;

  const botao = elemento('botao-mic');
  const rotuloDoBotao = { espera: 'Acordar', conectando: 'Conectando…', ativa: estado.mudo ? 'Reativar microfone' : 'Silenciar' }[estado.sessao];
  elemento('botao-mic-texto').textContent = rotuloDoBotao;
  botao.disabled = estado.sessao === 'conectando';
  elemento('nucleo').setAttribute('aria-label', { espera: 'Acordar o Frank', conectando: 'Conectando o Frank', ativa: estado.mudo ? 'Reativar o microfone' : 'Silenciar o microfone' }[estado.sessao]);
}

function definirSessao(sessao) {
  estado.sessao = sessao;
  if (sessao !== 'ativa') {
    estado.mudo = false;
    estado.frankFalando = false;
  }
  sincronizarEscuta();
  atualizarEstadoNaTela();
}

// A escuta do chamado roda só com a voz dormindo, a opção ligada, o microfone já liberado e o motor escolhido disponível.
function sincronizarEscuta() {
  const deveOuvir = estado.preferencias.acordarAoChamar
    && estado.sessao === 'espera'
    && estado.microfoneLiberado
    && infoDaConversa().disponivel;
  if (deveOuvir) escuta.ligar();
  else escuta.desligar();
}

// O valor é só da voz; quem paga o cérebro aparece no rótulo ao lado, escrito por atualizarEstadoNaTela.
function mostrarCusto(dolares) {
  elemento('custo-valor').textContent = formatarCusto(dolares);
}

function alterarPreferencias(parcial) {
  estado.preferencias = { ...estado.preferencias, ...parcial };
  salvarPreferencias(estado.preferencias);
  if ('tema' in parcial) {
    document.documentElement.dataset.tema = parcial.tema;
    hud.atualizarTema();
  }
  if (!('demandaId' in parcial)) estado.alertaNaTela = '';
  if ('acordarAoChamar' in parcial) sincronizarEscuta();
  atualizarEstadoNaTela();
}

function criarMotor(id) {
  const motor = MOTORES[id].criar({
    api,
    executarTurno: (opcoes) => executarTurno({ ...opcoes, origem: 'voz', motor }),
    aoRespostaDescartada: (resultado) => {
      if (estado.motor === motor) avisarEntregasDescartadas(resultado);
    },
    aoTranscrever: (fala) => {
      if (estado.motor !== motor) return;
      legendas.receber(fala);
      if (fala.quem === 'usuario') estado.ultimaVozDoUsuario = Date.now();
    },
    aoFalar: (falando) => {
      if (estado.motor !== motor) return;
      estado.frankFalando = falando;
      estado.ultimaVozDoFrank = Date.now();
      atualizarEstadoNaTela();
    },
    aoCusto: ({ dolares }) => {
      if (estado.motorDoCusto === motor) mostrarCusto(dolares);
    },
    aoEncerrar: ({ motivo, esperado }) => {
      if (estado.motor !== motor) return;
      estado.motor = null;
      definirSessao('espera');
      if (!esperado) {
        registro.adicionar(`A sessão caiu: ${motivo}.`, 'erro');
        anunciar(`A sessão do Frank caiu: ${motivo}.`);
      }
    },
    aoErro: ({ mensagem }) => registro.adicionar(mensagem, 'erro'),
    aoVozUsuario: () => {
      if (estado.motor === motor) estado.ultimaVozDoUsuario = Date.now();
    },
  });
  return motor;
}

function chamadoRecente() {
  const pendente = estado.chamadoPendente;
  return pendente && Date.now() - pendente.em <= VALIDADE_DO_CHAMADO_MS ? pendente.fala : '';
}

// A sessão abriu: o Frank responde ao chamado, dá os avisos que esperavam ou cumprimenta. Os avisos saem da fila só
// aqui, com a sessão de pé; se ela não abrir, eles continuam para a próxima vez.
function abrirSessao(motor, { nome, saudacao, chamado }) {
  if (estado.motor !== motor) return null;
  const abertura = aberturaDaSessao({ nome, saudacao, chamado, avisos: avisosDaVoz.retirar() });
  // A saudação que o Frank falou ao acordar vira o histórico semente da próxima demanda nova; aviso e pedido não.
  estado.saudacao = abertura.tipo === 'saudacao' ? saudacao : '';
  for (const aviso of abertura.depois) avisosDaVoz.adicionar(aviso);
  return abertura;
}

// chamado: a fala que acordou a voz pelo nome. motivo: toque, chamado ou aviso, só para o registro.
async function acordar({ chamado = '', motivo = 'toque' } = {}) {
  if (estado.sessao !== 'espera') return;
  const info = infoDaConversa();
  if (!info.disponivel) {
    const porque = estado.config ? info.motivo ?? '' : 'O painel ainda está lendo a configuração do servidor.';
    estado.alertaNaTela = `${info.nome} indisponível. ${porque}`.trim();
    registro.adicionar(estado.alertaNaTela, 'erro');
    atualizarEstadoNaTela();
    return;
  }

  contextoDeAudio();
  elemento('toque').hidden = true;
  estado.alertaNaTela = '';
  const fala = chamado || chamadoRecente();
  estado.chamadoPendente = null;
  const motor = criarMotor(info.id);
  estado.motor = motor;
  estado.motorEmUso = info.id;
  estado.motorDoCusto = motor;
  legendas.limpar();
  if (fala) {
    legendas.receber({ quem: 'usuario', texto: fala, parcial: false });
    registro.adicionar(`Você chamou o Frank: “${cortar(fala, LIMITE_DO_PEDIDO_NO_REGISTRO)}”`);
  }
  mostrarCusto(0);
  definirSessao('conectando');

  const nome = nomeDoDono();
  const saudacao = saudacaoDoFrank({ nome, data: new Date(), estado: quadro.estado(), anterior: estado.ultimaSaudacao });
  estado.ultimaSaudacao = saudacao;
  try {
    // A abertura é montada quando a sessão começa, e entram nela os avisos que chegaram durante a conexão.
    await motor.iniciar({ nome, voz: vozDoMotor(info.id), abertura: () => abrirSessao(motor, { nome, saudacao, chamado: fala }) });
    if (estado.motor !== motor) return;
    estado.microfoneLiberado = true;
    estado.ultimaVozDoUsuario = Date.now();
    estado.ultimaVozDoFrank = Date.now();
    definirSessao('ativa');
    registro.adicionar((REGISTRO_DO_DESPERTAR[motivo] ?? REGISTRO_DO_DESPERTAR.toque)(info.nome));
  } catch (erro) {
    const eraAtual = estado.motor === motor;
    if (eraAtual) estado.motor = null;
    motor.encerrar().catch((falha) => console.warn('O motor não fechou limpo depois da falha.', falha));
    if (!eraAtual) return;
    const mensagem = mensagemDoMicrofone(erro) ?? erro.message ?? 'O motor não ligou.';
    estado.alertaNaTela = mensagem;
    definirSessao('espera');
    registro.adicionar(`O Frank não acordou: ${mensagem}`, 'erro');
    if (avisosDaVoz.tamanho > 0) registro.adicionar('O aviso do Frank fica guardado para a próxima vez que a voz acordar.');
    console.warn(`Falha ao iniciar o ${info.nome}.`, erro);
  }
}

function encerrarSessao(motivo) {
  const motor = estado.motor;
  if (!motor) return;
  estado.motor = null;
  definirSessao('espera');
  registro.adicionar(motivo);
  motor.encerrar().catch((erro) => console.warn('O motor não fechou limpo.', erro));
}

const TEXTOS_DO_TOQUE = {
  som: 'O navegador pediu um clique antes de liberar o som.',
  microfone: 'O Frank tem um aviso. O navegador pede um clique para liberar o microfone.',
};

function pedirToque(motivo) {
  elemento('toque').querySelector('p').textContent = TEXTOS_DO_TOQUE[motivo];
  elemento('toque').hidden = false;
}

// Sessão aberta sem som liberado fala para ninguém e cobra igual: sem o som, o gatilho automático espera um toque.
async function somLiberadoParaAcordarSozinho() {
  if (await audioLiberado()) return true;
  pedirToque('som');
  return false;
}

// Algo para o Frank falar chegou com a voz dormindo: o painel acorda a sessão, e o aviso abre a conversa.
// Sem a permissão do microfone, o pedido dela ficaria parado numa aba que ninguém olha: o aviso espera um toque.
async function acordarParaAvisar() {
  if (estado.sessao !== 'espera' || !infoDaConversa().disponivel) return;
  if (!estado.microfoneLiberado) {
    pedirToque('microfone');
    return;
  }
  if (!(await somLiberadoParaAcordarSozinho())) return;
  if (estado.sessao === 'espera') acordar({ motivo: 'aviso' });
}

// "Frank" ouvido com a voz dormindo: acorda a sessão, e a fala vira a primeira mensagem dela.
async function acordarPeloChamado(fala) {
  if (estado.sessao !== 'espera') return;
  if (!(await somLiberadoParaAcordarSozinho())) {
    estado.chamadoPendente = { fala, em: Date.now() };
    sincronizarEscuta();
    return;
  }
  if (estado.sessao === 'espera') acordar({ chamado: fala, motivo: 'chamado' });
  else sincronizarEscuta();
}

function alternarMudo() {
  if (estado.sessao !== 'ativa' || !estado.motor) return;
  estado.mudo = !estado.mudo;
  estado.motor.silenciar(estado.mudo);
  anunciar(estado.mudo ? 'Microfone silenciado.' : 'Microfone reativado.');
  atualizarEstadoNaTela();
}

function acaoPrincipal() {
  if (estado.sessao === 'espera') acordar();
  else if (estado.sessao === 'ativa') alternarMudo();
}

// Seletor do topo: a escolha vale já para o próximo chamado. Com a voz acordada no motor antigo, ela dorme na hora.
function trocarMotor(id) {
  if (!MOTORES[id] || id === motorEscolhido()) return;
  alterarPreferencias({ motor: id });
  if (estado.motor) encerrarSessao(`Motor trocado para o ${MOTORES[id].nome}. Chame o Frank de novo para falar por ele.`);
  sincronizarEscuta();
  renderizarSeletorDeMotor();
}

function renderizarSeletorDeMotor() {
  const escolhido = motorEscolhido();
  const comChave = Object.keys(MOTORES).filter((id) => infoDaConversa(id).disponivel);
  elemento('seletor-motor').hidden = !estado.config || comChave.length < 2;
  for (const opcao of document.querySelectorAll('#seletor-motor input[name="motor"]')) {
    const info = infoDaConversa(opcao.value);
    opcao.checked = opcao.value === escolhido;
    const rotulo = opcao.closest('.seletor-opcao');
    if (!estado.config) delete rotulo.dataset.disponivel;
    else rotulo.dataset.disponivel = info.disponivel ? 'sim' : 'nao';
    rotulo.title = info.disponivel || !estado.config ? `Conversar pelo ${info.nome}` : `${info.nome} indisponível. ${info.motivo ?? ''}`.trim();
  }
}

function obterNiveis() {
  const motor = estado.motor;
  if (!motor || estado.sessao !== 'ativa') return { entrada: 0, saida: 0 };
  return { entrada: estado.mudo ? 0 : motor.nivelEntrada(), saida: motor.nivelSaida() };
}

function obterQuadro() {
  return {
    // Painel aceso: a voz dormindo ou reconectando não gira o anel nem zera a energia; só o nível da voz cai a zero.
    sessao: estado.simulandoDespertar || estado.visualAcordado ? 'ativa' : estado.sessao,
    mudo: estado.mudo,
    status: estado.estadoDoTime?.agentes.map((agente) => agente.status) ?? [],
  };
}

function vigiarVozes() {
  const motor = estado.motor;
  if (!motor || estado.sessao !== 'ativa') return;
  const agora = Date.now();
  // A fala do usuário conta só pela transcrição do motor de voz (aoVozUsuario). Volume não conta: com microfone sensível,
  // o barulho da sala passava do limite, zerava a espera e a voz paga nunca dormia.
  if (estado.frankFalando) estado.ultimaVozDoFrank = agora;

  const silencio = !estado.frankFalando
    && agora - estado.ultimaVozDoUsuario >= SILENCIO_ANTES_DO_AVISO_MS
    && agora - estado.ultimaVozDoFrank >= SILENCIO_ANTES_DO_AVISO_MS;
  if (avisosDaVoz.tamanho > 0 && silencio && motor.conectado) {
    const texto = avisosDaVoz.retirar().map((aviso) => aviso.texto).join(' ');
    motor.avisar(texto);
    estado.ultimaVozDoFrank = agora;
    registro.adicionar(`Aviso ao Frank: ${cortar(texto, LIMITE_DA_FALA_NO_REGISTRO)}`);
  }

  // A voz dorme mesmo com turno aberto no Hermes: o turno segue no SSE do painel, e o fim dele acorda a voz de novo.
  const dormir = vozDeveDormir({
    agora,
    esperaMs: estado.preferencias.esperaSegundos * 1000,
    frankFalando: estado.frankFalando,
    avisosNaFila: avisosDaVoz.tamanho,
    ultimaVozDoUsuario: estado.ultimaVozDoUsuario,
    ultimaVozDoFrank: estado.ultimaVozDoFrank,
    ultimoFimDeTurno: estado.ultimoFimDeTurno,
  });
  if (dormir) encerrarSessao(textoDoSonoDaVoz({ segundos: estado.preferencias.esperaSegundos, turnoAberto: estado.turnos.size > 0 }));
}

async function carregarConfig() {
  try {
    estado.config = await api.json('/api/config');
  } catch (erro) {
    estado.config = configSemServidor(erro.message);
    registro.adicionar(erro.message, 'erro');
  }
  const empresa = estado.config.dono?.empresa;
  document.title = empresa ? `Painel do Frank · ${empresa}` : 'Painel do Frank';
  // As configurações podem ter aberto antes da resposta, mostrando "carregando" nas vozes.
  configuracoes.atualizarVozes();
  renderizarSeletorDeMotor();
  sincronizarEscuta();
  atualizarEstadoNaTela();
}

async function microfoneJaLiberado() {
  try {
    const permissao = await navigator.permissions.query({ name: 'microphone' });
    return permissao.state === 'granted';
  } catch (erro) {
    console.warn('Este navegador não informa a permissão do microfone; o Frank espera um clique.', erro);
    return false;
  }
}

// Permissão já dada liga a escuta do chamado ao abrir; mudou no cadeado, a escuta acompanha.
async function acompanharMicrofone() {
  try {
    const permissao = await navigator.permissions.query({ name: 'microphone' });
    const aplicar = () => {
      estado.microfoneLiberado = permissao.state === 'granted';
      sincronizarEscuta();
      configuracoes.atualizarEscuta();
      atualizarEstadoNaTela();
    };
    permissao.addEventListener('change', aplicar);
    aplicar();
  } catch (erro) {
    console.warn('Este navegador não informa a permissão do microfone; a escuta do chamado começa depois do primeiro toque.', erro);
  }
}

async function acordarAoAbrir() {
  if (!estado.preferencias.acordarAoAbrir) return;
  if (!infoDaConversa().disponivel) return;
  if (!(await microfoneJaLiberado())) return;
  if (await audioLiberado()) acordar();
  else pedirToque('som');
}

function popoverAberto() {
  try {
    return Boolean(document.querySelector(':popover-open'));
  } catch {
    return false;
  }
}

function ligarControles() {
  elemento('botao-mic').addEventListener('click', acaoPrincipal);
  elemento('nucleo').addEventListener('click', acaoPrincipal);
  elemento('toque-botao').addEventListener('click', () => acordar());
  elemento('botao-config').addEventListener('click', (evento) => configuracoes.abrir(evento.currentTarget));
  elemento('botao-ajuda').addEventListener('click', (evento) => abrirAjuda(elemento('dialogo-ajuda'), evento.currentTarget));
  for (const opcao of document.querySelectorAll('#seletor-motor input[name="motor"]')) {
    opcao.addEventListener('change', () => {
      if (opcao.checked) trocarMotor(opcao.value);
    });
  }

  // Depois de um clique com o mouse o foco sai do botão, para o Espaço voltar a ser o atalho do microfone.
  document.addEventListener('click', (evento) => {
    if (evento.detail === 0) return;
    const botao = evento.target.closest('button');
    if (botao && !botao.closest('dialog, [popover]') && document.activeElement === botao) botao.blur();
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.defaultPrevented || evento.metaKey || evento.ctrlKey || evento.altKey) return;
    // Com a lista de demandas aberta, o Esc só fecha a lista (não encerra a sessão).
    if (document.querySelector('dialog[open]') || popoverAberto()) return;
    const alvo = evento.target;
    if (alvo.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (evento.key === ' ' && alvo.closest?.('button, a, summary, label')) return;

    if (evento.key === ' ') {
      evento.preventDefault();
      acaoPrincipal();
    } else if (evento.key === 'Escape') {
      encerrarSessao('Sessão encerrada.');
    } else if (evento.key === '?') {
      abrirAjuda(elemento('dialogo-ajuda'), elemento('botao-ajuda'));
    }
  });

  window.addEventListener('pagehide', () => {
    escuta.desligar();
    estado.motor?.encerrar();
    for (const turno of estado.turnos) turno.controle.abort();
  });
}

window.__frank = {
  // Turno real pelas rotas /api/frank/*, sem voz: roda no Hermes, com o cérebro escolhido nas configurações.
  async turno(texto) {
    const resultado = await executarTurno({ texto, origem: 'teste' });
    return {
      demandaId: resultado.demandaId,
      runId: resultado.runId,
      fala: resultado.fim?.fala ?? null,
      modelo: resultado.fim?.modelo ?? null,
      aprovacao: resultado.aprovacao ?? null,
      entregas: resultado.entregas.length,
    };
  },
  // Eventos normalizados do contrato aplicados direto no painel, sem servidor nem Hermes.
  aplicar(eventos, { runId = 'run-teste', demandaId = estado.demanda?.id ?? null } = {}) {
    const turno = { runId, demandaId, origem: 'teste', delegacaoId: null, entregas: [] };
    for (const bruto of [].concat(eventos)) {
      const evento = normalizarEvento(bruto);
      if (evento) aplicarEventoDoTurno(evento, turno);
    }
    return quadro.estado();
  },
  encerrarTurno(runId = 'run-teste') {
    quadro.encerrarRun(runId);
    renderizarTime();
    return quadro.estado();
  },
  decidir: (chave, decisao, observacao) => decidirPeloPainel(chave, decisao, observacao),
  estado: () => ({
    demanda: estado.demanda,
    turnos: estado.turnos.size,
    cerebro: cerebroEmUso(estado.preferencias.cerebro, estado.modelos),
    autorizacao: autorizacoes.estado(),
    voz: { sessao: estado.sessao, avisos: avisosDaVoz.pendentes(), escuta: escuta.estado() },
    ...quadro.estado(),
  }),
  demandas: () => seletorDeDemandas.abrir(),
  // Só anima o HUD, sem abrir sessão nem gastar nada: o Frank acorda o time e volta à espera depois do prazo.
  simularAcordar(duracaoMs = 8000) {
    if (estado.sessao !== 'espera') return false;
    clearTimeout(estado.prazoDaSimulacao);
    estado.simulandoDespertar = true;
    hud.acordar();
    estado.prazoDaSimulacao = setTimeout(() => {
      estado.simulandoDespertar = false;
      if (!estado.visualAcordado) hud.adormecer();
    }, duracaoMs);
    return true;
  },
};

iniciarRelogio({
  hora: elemento('relogio-hora'),
  segundos: elemento('relogio-seg'),
  data: elemento('relogio-data'),
  ponteiros: { hora: elemento('ponteiro-hora'), minuto: elemento('ponteiro-minuto'), segundo: elemento('ponteiro-segundo') },
  mostrador: elemento('relogio-icone'),
});
seletorDeDemandas.definir(estado.demanda);
renderizarTime();
ligarControles();
renderizarSeletorDeMotor();
atualizarEstadoNaTela();
setInterval(vigiarVozes, 100);
document.fonts?.ready.then(() => hud.relayout());

await carregarConfig();
carregarModelos();
sincronizarDemanda();
// Também recupera após indisponibilidade momentânea, sem reabrir runs já acompanhados.
setInterval(() => { if (!document.hidden) sincronizarDemanda({ silencioso: true }); }, 10_000);
lerQuadroKanban();
setInterval(lerQuadroKanban, INTERVALO_DO_QUADRO_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lerQuadroKanban();
});
await acompanharMicrofone();
await acordarAoAbrir();
