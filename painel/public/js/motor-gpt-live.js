import { medidorDeStream } from './audio.js';
import { criarNarrador } from './narrador.js';
import { criarRitmoPorVoz } from './ritmo-da-legenda.js';
import { falaDoPedido, fusoDoNavegador, instrucaoDaSaudacao, textoDaRespostaPorVoz, textoDeAutorizacaoPendente, textoDoPensamento } from './painel-logica.js';

const ESPERA_ICE_MS = 10_000;
const ESPERA_FECHAMENTO_MS = 15_000;
// No WebRTC, "disconnected" costuma ser um soluço de rede que volta sozinho; "failed" não volta.
const CARENCIA_DE_RECONEXAO_MS = 8_000;
// Teto do fornecedor: 500 tokens por append. Cerca de 4 caracteres por token, com folga.
const LIMITE_POR_APPEND = 1_400;
const JANELA_DE_CONTEXTO_MS = 5 * 60_000;
const MAXIMO_DE_TRECHOS = 80;
const DOLARES_POR_MINUTO = 0.05;
const LIMIAR_FRANK_FALANDO = 0.03;
// O GPT Live fala o commentary com as próprias palavras; estes textos dão o conteúdo, no tom do Frank.
const FALA_DE_ERRO = 'Travei aqui do meu lado e não consegui falar com o time. Repete o pedido pra mim?';
const FALA_SEM_PEDIDO = 'Não peguei direito o que você falou. Repete pra mim?';
const PENSAMENTO_SEM_FALA = 'O time terminou, mas não mandou nada para falar agora.';

export function dividirComentario(texto, limite = LIMITE_POR_APPEND) {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  if (!limpo) return [];
  if (limpo.length <= limite) return [limpo];
  const partes = [];
  let atual = '';
  for (const frase of limpo.split(/(?<=[.!?])\s+/)) {
    if (frase.length > limite) {
      if (atual) partes.push(atual);
      atual = '';
      for (let inicio = 0; inicio < frase.length; inicio += limite) partes.push(frase.slice(inicio, inicio + limite));
      continue;
    }
    const candidato = atual ? `${atual} ${frase}` : frase;
    if (candidato.length > limite) {
      partes.push(atual);
      atual = frase;
    } else {
      atual = candidato;
    }
  }
  if (atual) partes.push(atual);
  return partes;
}

function esperarIce(conexao) {
  if (conexao.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolver, rejeitar) => {
    const prazo = setTimeout(() => {
      conexao.removeEventListener('icegatheringstatechange', aoMudar);
      // Sem todos os candidatos o fornecedor responde com os que recebeu.
      resolver();
    }, ESPERA_ICE_MS);
    function aoMudar() {
      if (conexao.iceGatheringState !== 'complete') return;
      clearTimeout(prazo);
      conexao.removeEventListener('icegatheringstatechange', aoMudar);
      resolver();
    }
    conexao.addEventListener('icegatheringstatechange', aoMudar);
    conexao.addEventListener('connectionstatechange', () => {
      if (conexao.connectionState !== 'failed') return;
      clearTimeout(prazo);
      rejeitar(new Error('A conexão de áudio com a OpenAI falhou.'));
    });
  });
}

// executarTurno({ texto, aoEvento }) roda o turno no Hermes (POST /api/frank/turno + SSE) e resolve com { fim, ... }.
export function criarMotorGptLive({ api, executarTurno, aoRespostaDescartada, aoTranscrever, aoFalar, aoCusto, aoEncerrar, aoErro, aoVozUsuario }) {
  const audio = new Audio();
  audio.autoplay = true;
  let conexao = null;
  let canal = null;
  let microfone = null;
  let medidorEntrada = null;
  let medidorSaida = null;
  let sondaDeFala = 0;
  let prazoDeFechamento = 0;
  let prazoDeReconexao = 0;
  let liberarSomNoClique = null;
  let finalizado = false;
  let iniciado = false;
  let pedidoDeFechamento = false;
  let contadorDeEventos = 0;
  let falando = false;
  let quadrosQuietos = 0;
  let transcricao = [];
  let delegacaoAtiva = null;
  let usuarioFalouEm = 0;
  let pontes = 0;
  // A transcrição da voz chega antes do som: a legenda mostra no ritmo da voz.
  const legenda = criarRitmoPorVoz({ aoMostrar: (trecho) => aoTranscrever({ quem: 'frank', texto: trecho, parcial: true }) });
  // Delegações com turno ainda rodando no Hermes.
  const emAndamento = new Set();
  // O que o Frank faz quando a sessão começa: { instrucao, comentario, falaDoUsuario }, ou uma função que monta isso na hora.
  let aberturaPendente = null;
  const esperasDeFechamento = [];

  function enviar(evento) {
    if (!canal || canal.readyState !== 'open') return false;
    canal.send(JSON.stringify(evento));
    return true;
  }

  function proximoId(prefixo) {
    contadorDeEventos += 1;
    return `${prefixo}_${contadorDeEventos}`;
  }

  function instruir(texto) {
    enviar({ type: 'session.instructions.append', event_id: proximoId('instr'), delegation_id: null, content: texto.trim().slice(0, LIMITE_POR_APPEND) });
  }

  function comentar(delegacaoId, texto) {
    for (const parte of dividirComentario(texto)) {
      enviar({ type: 'session.commentary.append', event_id: proximoId('say'), delegation_id: delegacaoId, content: parte });
    }
  }

  function pensar(delegacaoId, texto) {
    enviar({ type: 'session.thinking.append', event_id: proximoId('think'), delegation_id: delegacaoId, content: texto.slice(0, LIMITE_POR_APPEND) });
  }

  function contextoRecente() {
    const ultimo = transcricao.at(-1);
    if (!ultimo) return [];
    const piso = ultimo.fimMs - JANELA_DE_CONTEXTO_MS;
    const turnos = [];
    for (const trecho of transcricao.filter((item) => item.fimMs >= piso).slice(-MAXIMO_DE_TRECHOS)) {
      const anterior = turnos.at(-1);
      if (anterior && anterior.quem === trecho.quem) anterior.texto += trecho.texto;
      else turnos.push({ quem: trecho.quem, texto: trecho.texto });
    }
    return turnos.map((turno) => ({ quem: turno.quem, texto: turno.texto.replace(/\s+/g, ' ').trim() })).filter((turno) => turno.texto);
  }

  // Cada delegação vira um turno no Hermes. O stream de uma delegação velha continua aberto (as entregas dela
  // ainda chegam ao painel), mas a resposta falada fica só com a delegação mais recente.
  // Exceção: a delegação que não abre turno (fala vazia, resposta a uma autorização ou turno recusado pelo servidor)
  // devolve a vez a quem esperava, para a fala final do turno pausado não ser descartada.
  async function responderDelegacao(delegacaoId) {
    const anterior = delegacaoAtiva;
    delegacaoAtiva = delegacaoId;
    // Sessão fechando (a voz foi dormir) não fala mais: o painel entrega o resultado acordando a voz de novo.
    const valeAinda = () => !finalizado && !pedidoDeFechamento && delegacaoAtiva === delegacaoId;
    const devolverAVez = () => {
      if (delegacaoAtiva === delegacaoId) delegacaoAtiva = anterior && emAndamento.has(anterior) ? anterior : null;
    };
    const texto = falaDoPedido(contextoRecente());
    if (!texto) {
      comentar(delegacaoId, FALA_SEM_PEDIDO);
      devolverAVez();
      return;
    }
    emAndamento.add(delegacaoId);
    const narrador = criarNarrador({
      narrar: (fala) => valeAinda() && comentar(delegacaoId, fala),
      falando: () => falando,
      usuarioFalouEm: () => usuarioFalouEm,
      ponte: pontes++,
    });
    try {
      const resultado = await executarTurno({
        texto,
        delegacaoId,
        aoEvento: (evento) => {
          narrador.evento(evento);
          if (evento.tipo === 'agente_inicio' && valeAinda()) pensar(delegacaoId, textoDoPensamento(evento.agente, evento.tarefa));
        },
      });
      if (finalizado || pedidoDeFechamento) return;
      // A fala era o sim ou o não da autorização: o servidor não abriu run, e o turno que pediu segue.
      if (resultado.aprovacao) {
        if (valeAinda()) comentar(delegacaoId, textoDaRespostaPorVoz(resultado.aprovacao));
        devolverAVez();
        return;
      }
      if (delegacaoAtiva !== delegacaoId) {
        aoRespostaDescartada?.(resultado);
        return;
      }
      if (resultado.fim.fala) comentar(delegacaoId, resultado.fim.fala);
      else pensar(delegacaoId, PENSAMENTO_SEM_FALA);
    } catch (erro) {
      // Com autorização de pé, fala que não é sim nem não volta com 409: o Frank repete o pedido.
      if (erro?.aprovacaoPendente) {
        if (valeAinda()) comentar(delegacaoId, textoDeAutorizacaoPendente(erro.aprovacaoPendente));
        devolverAVez();
        return;
      }
      // O painel já registrou a falha do turno; aqui só o Frank avisa, se a delegação ainda for a da vez.
      if (valeAinda()) comentar(delegacaoId, FALA_DE_ERRO);
      // O servidor nem aceitou o turno (como o sim que chega depois do prazo, 409 sem pedido de pé): não toma a vez.
      if (!erro?.aceito) devolverAVez();
    } finally {
      narrador.parar();
      emAndamento.delete(delegacaoId);
      if (delegacaoAtiva === delegacaoId) delegacaoAtiva = null;
    }
  }

  // A fala que acordou a voz entra na janela de transcrição como fala do usuário: a delegação que ela gerar sai com esse texto.
  function abrirConversa(abertura) {
    if (!abertura) return;
    if (abertura.falaDoUsuario) transcricao.push({ quem: 'usuario', texto: abertura.falaDoUsuario, inicioMs: 0, fimMs: 0 });
    if (abertura.instrucao) instruir(abertura.instrucao);
    if (abertura.comentario) comentar(null, abertura.comentario);
  }

  function tratarEvento(bruto) {
    let evento;
    try {
      evento = JSON.parse(bruto);
    } catch (erro) {
      console.warn('Evento do GPT Live fora do formato JSON, ignorado.', erro);
      return;
    }
    switch (evento.type) {
      case 'session.started': {
        iniciado = true;
        const pendente = aberturaPendente;
        aberturaPendente = null;
        try {
          abrirConversa(typeof pendente === 'function' ? pendente() : pendente);
        } catch (erro) {
          console.warn('A abertura da sessão falhou; o Frank fica esperando o usuário falar.', erro);
        }
        return;
      }
      case 'session.input_transcript.delta':
      case 'session.output_transcript.delta': {
        const quem = evento.type === 'session.input_transcript.delta' ? 'usuario' : 'frank';
        const trecho = { quem, texto: evento.delta ?? '', inicioMs: evento.start_ms ?? 0, fimMs: evento.end_ms ?? 0 };
        transcricao.push(trecho);
        if (transcricao.length > 2_000) transcricao = transcricao.slice(-1_500);
        if (quem === 'frank') legenda.receber(trecho.texto);
        else aoTranscrever({ quem, texto: trecho.texto, parcial: true });
        if (quem === 'usuario') {
          usuarioFalouEm = Date.now();
          aoVozUsuario();
        }
        return;
      }
      case 'session.delegation.created':
        if (evento.delegation?.id) responderDelegacao(evento.delegation.id);
        return;
      case 'session.usage.updated':
        if (typeof evento.usage?.seconds === 'number') aoCusto({ dolares: (evento.usage.seconds / 60) * DOLARES_POR_MINUTO, estimativa: false });
        return;
      case 'session.closed':
        if (typeof evento.usage?.seconds === 'number') aoCusto({ dolares: (evento.usage.seconds / 60) * DOLARES_POR_MINUTO, estimativa: false });
        finalizar(evento.reason ?? 'sessão fechada pela OpenAI');
        return;
      case 'error':
        // Append atrasado depois do nosso próprio fechamento é ruído esperado.
        if (evento.error?.code === 'context_injection_incomplete') return;
        aoErro({ mensagem: `GPT Live: ${evento.error?.message ?? 'erro sem descrição'}`, fatal: false });
        return;
      default:
    }
  }

  function vigiarFala() {
    sondaDeFala = setInterval(() => {
      legenda.tique();
      const alto = (medidorSaida?.nivel() ?? 0) > LIMIAR_FRANK_FALANDO;
      quadrosQuietos = alto ? 0 : quadrosQuietos + 1;
      const agora = alto || quadrosQuietos < 4;
      if (agora === falando) return;
      falando = agora;
      legenda.falando(falando);
      aoFalar(falando);
    }, 100);
  }

  function finalizar(motivo) {
    if (finalizado) return;
    finalizado = true;
    clearTimeout(prazoDeFechamento);
    clearTimeout(prazoDeReconexao);
    if (liberarSomNoClique) document.removeEventListener('click', liberarSomNoClique);
    clearInterval(sondaDeFala);
    medidorEntrada?.desligar();
    medidorSaida?.desligar();
    microfone?.getTracks().forEach((faixa) => faixa.stop());
    canal?.close();
    conexao?.close();
    audio.pause();
    audio.srcObject = null;
    if (falando) aoFalar(false);
    aoEncerrar({ motivo, esperado: pedidoDeFechamento });
    for (const resolver of esperasDeFechamento.splice(0)) resolver();
  }

  async function iniciar({ nome, voz, saudacao, resumo, abertura }) {
    if (conexao) throw new Error('A sessão do GPT Live já foi iniciada.');
    aberturaPendente = abertura ?? { instrucao: instrucaoDaSaudacao(`${saudacao}, ${nome}. ${resumo}`) };
    conexao = new RTCPeerConnection();
    conexao.addEventListener('track', (evento) => {
      const stream = evento.streams[0] ?? new MediaStream([evento.track]);
      audio.srcObject = stream;
      audio.play().catch((erro) => {
        aoErro({ mensagem: `O navegador segurou o som do Frank: ${erro.message}. Clique na página para liberar.`, fatal: false });
        if (liberarSomNoClique) return;
        liberarSomNoClique = () => {
          liberarSomNoClique = null;
          if (!finalizado) audio.play().catch((falha) => aoErro({ mensagem: `O som do Frank continua bloqueado: ${falha.message}`, fatal: false }));
        };
        document.addEventListener('click', liberarSomNoClique, { once: true });
      });
      medidorSaida = medidorDeStream(stream);
      vigiarFala();
    });
    conexao.addEventListener('connectionstatechange', () => {
      const estadoDaConexao = conexao.connectionState;
      if (estadoDaConexao === 'failed') {
        finalizar('a conexão de áudio caiu');
      } else if (estadoDaConexao === 'disconnected') {
        if (prazoDeReconexao) return;
        console.warn(`Conexão de áudio do GPT Live oscilou; esperando até ${CARENCIA_DE_RECONEXAO_MS / 1000} s ela voltar.`);
        prazoDeReconexao = setTimeout(() => finalizar(`a conexão de áudio caiu e não voltou em ${CARENCIA_DE_RECONEXAO_MS / 1000} s`), CARENCIA_DE_RECONEXAO_MS);
      } else if (estadoDaConexao === 'connected' && prazoDeReconexao) {
        clearTimeout(prazoDeReconexao);
        prazoDeReconexao = 0;
        console.info('Conexão de áudio do GPT Live recuperada.');
      }
    });

    const capturado = await navigator.mediaDevices.getUserMedia({ audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true } });
    if (finalizado) {
      capturado.getTracks().forEach((faixa) => faixa.stop());
      throw new Error('Sessão cancelada antes de conectar.');
    }
    microfone = capturado;
    medidorEntrada = medidorDeStream(microfone);
    for (const faixa of microfone.getAudioTracks()) conexao.addTrack(faixa, microfone);

    // O canal precisa existir antes da oferta para entrar na negociação.
    canal = conexao.createDataChannel('oai-events');
    canal.addEventListener('message', ({ data }) => tratarEvento(String(data)));
    canal.addEventListener('close', () => finalizar('o canal de eventos fechou'));

    await conexao.setLocalDescription(await conexao.createOffer());
    await esperarIce(conexao);
    const sdp = conexao.localDescription?.sdp;
    if (!sdp) throw new Error('O navegador não gerou a oferta de áudio.');
    const resposta = await api.json('/api/live/session', { metodo: 'POST', corpo: { sdp, nome, voz, fuso: fusoDoNavegador() }, timeoutMs: 45_000 });
    if (finalizado) throw new Error('Sessão cancelada antes de conectar.');
    await conexao.setRemoteDescription({ type: 'answer', sdp: resposta.sdp });
  }

  return {
    iniciar,
    encerrar() {
      if (finalizado) return Promise.resolve();
      pedidoDeFechamento = true;
      const fechou = new Promise((resolver) => esperasDeFechamento.push(resolver));
      if (!enviar({ type: 'session.close' })) finalizar('encerrada por você');
      else prazoDeFechamento = setTimeout(() => finalizar('encerrada por você'), ESPERA_FECHAMENTO_MS);
      return fechou;
    },
    silenciar(mudo) {
      for (const faixa of microfone?.getAudioTracks() ?? []) faixa.enabled = !mudo;
      enviar({ type: mudo ? 'session.input_audio.mute' : 'session.input_audio.unmute', event_id: proximoId(mudo ? 'mute' : 'unmute') });
    },
    avisar(texto) {
      comentar(null, texto);
    },
    // Fala sobre um turno que ainda roda (o pedido de autorização): no fio da delegação dele enquanto ela é a da vez;
    // senão, como contexto geral da sessão, para o pedido não se perder.
    falarSobreTurno(delegacaoId, texto) {
      if (finalizado || pedidoDeFechamento) return;
      comentar(delegacaoId && delegacaoId === delegacaoAtiva ? delegacaoId : null, texto);
    },
    nivelEntrada: () => medidorEntrada?.nivel() ?? 0,
    nivelSaida: () => medidorSaida?.nivel() ?? 0,
    get conectado() {
      return iniciado && !finalizado && canal?.readyState === 'open';
    },
  };
}
