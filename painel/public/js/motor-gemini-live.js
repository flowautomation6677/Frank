import { contextoDeAudio, criarMedidor, medidorDeStream } from './audio.js';
import { FERRAMENTA_DO_ANDAMENTO, FERRAMENTA_DO_TIME, ROTULOS_DO_PAINEL, criarDelegacao } from './delegacao-por-ferramenta.js';
import { fusoDoNavegador } from './painel-logica.js';
import { FIM_DA_FALA_MS, criarRitmoDaLegenda } from './ritmo-da-legenda.js';

const TAXA_DA_SAIDA = 24_000;
const ESPERA_DO_SETUP_MS = 15_000;
// Sem a folga, "falando" piscaria no vão entre um trecho de áudio e o próximo.
const FOLGA_DA_FALA_S = 0.25;
const ATRASO_DO_PRIMEIRO_TRECHO_S = 0.05;
// Preço pago do Gemini 3.8 Live por milhão de tokens (ai.google.dev/gemini-api/docs/pricing, consultado em 04/10/2026).
// Cada turno cobra o contexto inteiro, e o usageMetadata de cada turno já traz a conta dele.
const DOLARES_POR_MILHAO = Object.freeze({
  entrada: Object.freeze({ TEXT: 0.75, AUDIO: 3, IMAGE: 1, VIDEO: 1 }),
  saida: Object.freeze({ TEXT: 4.5, AUDIO: 12 }),
});
const ENDERECO_DO_CAPTURADOR = new URL('./captura-do-microfone.worklet.js', import.meta.url);
const capturadores = new WeakMap();

export function paraBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binario = '';
  for (let inicio = 0; inicio < bytes.length; inicio += 0x8000) binario += String.fromCharCode(...bytes.subarray(inicio, inicio + 0x8000));
  return btoa(binario);
}

// PCM de 16 bits little-endian em base64 → amostras de -1 a 1.
export function amostrasDeBase64(base64) {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let indice = 0; indice < binario.length; indice += 1) bytes[indice] = binario.charCodeAt(indice);
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const amostras = new Float32Array(pcm.length);
  for (let indice = 0; indice < pcm.length; indice += 1) amostras[indice] = pcm[indice] / 0x8000;
  return amostras;
}

// Os tokens fora do detalhamento por modalidade (chamada de ferramenta, por exemplo) contam como texto.
function custoDaParte(total, detalhes, tabela) {
  let somados = 0;
  let dolares = 0;
  for (const item of Array.isArray(detalhes) ? detalhes : []) {
    const tokens = Number(item?.tokenCount) || 0;
    somados += tokens;
    dolares += tokens * (tabela[item?.modality] ?? tabela.TEXT);
  }
  return dolares + Math.max(0, (Number(total) || 0) - somados) * tabela.TEXT;
}

export function custoDoUso(uso) {
  const entrada = custoDaParte(uso?.promptTokenCount, uso?.promptTokensDetails, DOLARES_POR_MILHAO.entrada);
  const saida = custoDaParte(uso?.responseTokenCount, uso?.responseTokensDetails, DOLARES_POR_MILHAO.saida);
  const pensamento = (Number(uso?.thoughtsTokenCount) || 0) * DOLARES_POR_MILHAO.saida.TEXT;
  return (entrada + saida + pensamento) / 1_000_000;
}

export function lerMensagem(dados) {
  const texto = typeof dados === 'string' ? dados : new TextDecoder().decode(dados);
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

function motivoDoFechamento({ code, reason }) {
  if (code === 1000) return 'sessão fechada pelo Gemini';
  return `a conexão com o Gemini caiu (código ${code}${reason ? `: ${reason}` : ''})`;
}

function carregarCapturador(contexto) {
  if (!capturadores.has(contexto)) capturadores.set(contexto, contexto.audioWorklet.addModule(ENDERECO_DO_CAPTURADOR));
  return capturadores.get(contexto);
}

// Mesmo contrato do criarMotorGptLive. A delegação vai pela ferramenta falar_com_o_time (NON_BLOCKING): o Frank fala uma
// ponte e segue ouvindo, e o resultado volta na resposta da ferramenta, com scheduling WHEN_IDLE para não cortar ninguém.
export function criarMotorGeminiLive({ api, executarTurno, aoRespostaDescartada, aoTranscrever, aoFalar, aoCusto, aoEncerrar, aoErro, aoVozUsuario }) {
  let ws = null;
  let microfone = null;
  let fonteDoMicrofone = null;
  let capturador = null;
  let medidorEntrada = null;
  let saida = null;
  let medidorSaida = null;
  let fimDaFala = 0;
  let sondaDeFala = 0;
  let falando = false;
  let pronto = false;
  let finalizado = false;
  let pedidoDeFechamento = false;
  let mudo = false;
  let dolares = 0;
  let ultimoFalante = null;
  let ultimaFalaDoUsuario = '';
  let usuarioFalouEm = 0;
  let aberturaPendente = null;
  let aoFicarPronto = null;
  const trechos = new Set();
  // Áudio da fala atual do Frank no relógio do contexto de áudio: a legenda anda na proporção do que já tocou.
  let trechosDaFala = [];
  let falaFechada = false;
  let ultimoTextoDoFrank = 0;
  const legenda = criarRitmoDaLegenda({ aoMostrar: (trecho) => transcrever('frank', trecho) });
  // Chamadas que o Gemini cancelou: não aceitam mais toolResponse, então o resultado vai como mensagem do painel.
  const canceladas = new Set();
  const esperasDeFechamento = [];

  const delegacao = criarDelegacao({
    executarTurno,
    aoRespostaDescartada,
    responder: (id, texto, { falar }) => responderFerramenta(id, FERRAMENTA_DO_TIME, texto, falar ? 'WHEN_IDLE' : 'SILENT'),
    aberta: () => !finalizado && !pedidoDeFechamento,
    narrar: (texto) => enviarTexto(`${ROTULOS_DO_PAINEL.trabalhando} ${texto}`),
    falando: () => falando,
    usuarioFalouEm: () => usuarioFalouEm,
  });

  function enviar(mensagem) {
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(mensagem));
    return true;
  }

  function enviarTexto(texto) {
    const limpo = String(texto ?? '').replace(/\s+/g, ' ').trim();
    if (limpo) enviar({ realtimeInput: { text: limpo } });
  }

  function responderFerramenta(id, nome, texto, agendamento) {
    if (canceladas.delete(id)) {
      if (agendamento === 'WHEN_IDLE') enviarTexto(`${ROTULOS_DO_PAINEL.resultado} ${texto}`);
      return;
    }
    const response = agendamento ? { result: texto, scheduling: agendamento } : { result: texto };
    enviar({ toolResponse: { functionResponses: [{ id, name: nome, response }] } });
  }

  function tratarFerramentas(chamadas) {
    for (const chamada of Array.isArray(chamadas) ? chamadas : []) {
      if (!chamada?.id) continue;
      if (chamada.name === FERRAMENTA_DO_TIME) delegacao.delegar(chamada.id, chamada.args?.pedido, ultimaFalaDoUsuario);
      else if (chamada.name === FERRAMENTA_DO_ANDAMENTO) responderFerramenta(chamada.id, chamada.name, delegacao.andamento());
      else responderFerramenta(chamada.id, chamada.name, `A ferramenta ${chamada.name} não existe neste painel.`);
    }
  }

  function tocar(base64) {
    const amostras = amostrasDeBase64(base64);
    if (!saida || amostras.length === 0) return;
    const contexto = saida.context;
    const buffer = contexto.createBuffer(1, amostras.length, TAXA_DA_SAIDA);
    buffer.copyToChannel(amostras, 0);
    const trecho = contexto.createBufferSource();
    trecho.buffer = buffer;
    trecho.connect(saida);
    const inicio = Math.max(fimDaFala, contexto.currentTime + ATRASO_DO_PRIMEIRO_TRECHO_S);
    trecho.start(inicio);
    fimDaFala = inicio + buffer.duration;
    if (falaFechada) encerrarFala();
    trechosDaFala.push({ inicio, duracao: buffer.duration });
    trechos.add(trecho);
    trecho.addEventListener('ended', () => trechos.delete(trecho));
  }

  function calar() {
    for (const trecho of trechos) {
      try {
        trecho.stop();
      } catch {
        // O trecho já tinha terminado.
      }
    }
    trechos.clear();
    fimDaFala = 0;
    legenda.cortar();
    trechosDaFala = [];
    falaFechada = false;
  }

  function encerrarFala() {
    legenda.terminar();
    trechosDaFala = [];
    falaFechada = false;
  }

  function andarLegenda() {
    const contexto = saida?.context;
    if (!contexto) return;
    let tocado = 0;
    let total = 0;
    for (const { inicio, duracao } of trechosDaFala) {
      total += duracao;
      tocado += Math.min(duracao, Math.max(0, contexto.currentTime - inicio));
    }
    if (falaFechada && tocado >= total - 0.01) {
      encerrarFala();
      return;
    }
    // Transcrição sem som (o áudio não veio, ou veio todo antes): ela aparece depois de um tempo.
    if (total === 0) {
      if (legenda.pendente > 0 && Date.now() - ultimoTextoDoFrank > FIM_DA_FALA_MS) legenda.terminar();
      return;
    }
    legenda.tique({ tocado, total });
  }

  function transcrever(quem, texto) {
    if (!texto) return;
    if (quem === 'usuario') {
      ultimaFalaDoUsuario = ultimoFalante === 'usuario' ? ultimaFalaDoUsuario + texto : texto;
      usuarioFalouEm = Date.now();
      aoVozUsuario();
    }
    ultimoFalante = quem;
    aoTranscrever({ quem, texto, parcial: true });
  }

  function tratarMensagem(dados) {
    const mensagem = lerMensagem(dados);
    if (!mensagem) {
      console.warn('Mensagem do Gemini Live fora do formato JSON, ignorada.');
      return;
    }
    if (mensagem.setupComplete) aoFicarPronto?.();
    const conteudo = mensagem.serverContent;
    if (conteudo) {
      if (conteudo.interrupted) calar();
      for (const parte of conteudo.modelTurn?.parts ?? []) {
        if (parte.inlineData?.data && !finalizado) tocar(parte.inlineData.data);
      }
      transcrever('usuario', conteudo.inputTranscription?.text);
      if (conteudo.outputTranscription?.text) {
        if (falaFechada) encerrarFala();
        // Quem falou por último conta na chegada: a legenda mostra depois, e a fala seguinte do usuário começa do zero.
        ultimoFalante = 'frank';
        legenda.receber(conteudo.outputTranscription.text);
        ultimoTextoDoFrank = Date.now();
      }
      if (conteudo.turnComplete || conteudo.generationComplete) falaFechada = true;
    }
    if (mensagem.toolCall) tratarFerramentas(mensagem.toolCall.functionCalls);
    for (const id of mensagem.toolCallCancellation?.ids ?? []) canceladas.add(id);
    if (mensagem.usageMetadata) {
      dolares += custoDoUso(mensagem.usageMetadata);
      aoCusto({ dolares, estimativa: true });
    }
    if (mensagem.goAway) console.info(`O Gemini Live avisou que fecha a conexão em ${mensagem.goAway.timeLeft ?? 'pouco tempo'}.`);
  }

  // Gemini aceita texto do usuário: o chamado vai como a fala dele, sem a instrução que o GPT Live precisa.
  function abrirConversa(abertura) {
    if (!abertura) return;
    if (abertura.falaDoUsuario) {
      ultimaFalaDoUsuario = abertura.falaDoUsuario;
      ultimoFalante = 'usuario';
      enviarTexto(abertura.falaDoUsuario);
      return;
    }
    if (abertura.instrucao) enviarTexto(`${ROTULOS_DO_PAINEL.instrucao} ${abertura.instrucao}`);
    if (abertura.comentario) enviarTexto(`${ROTULOS_DO_PAINEL.aviso} ${abertura.comentario}`);
  }

  // Com o contexto de áudio suspenso o relógio para e o som não sai: o Frank não está falando, mesmo com trecho na fila.
  function vigiarFala() {
    sondaDeFala = setInterval(() => {
      andarLegenda();
      const contexto = saida?.context;
      const agora = Boolean(contexto) && contexto.state === 'running' && contexto.currentTime < fimDaFala + FOLGA_DA_FALA_S;
      if (agora === falando) return;
      falando = agora;
      aoFalar(falando);
    }, 100);
  }

  function finalizar(motivo) {
    if (finalizado) return;
    finalizado = true;
    clearInterval(sondaDeFala);
    if (capturador) capturador.port.onmessage = null;
    fonteDoMicrofone?.disconnect();
    capturador?.disconnect();
    medidorEntrada?.desligar();
    medidorSaida?.desligar();
    calar();
    saida?.disconnect();
    microfone?.getTracks().forEach((faixa) => faixa.stop());
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);
    if (falando) aoFalar(false);
    falando = false;
    aoEncerrar({ motivo, esperado: pedidoDeFechamento });
    for (const resolver of esperasDeFechamento.splice(0)) resolver();
  }

  function conectar({ token, modelo, endereco }) {
    return new Promise((resolver, rejeitar) => {
      const prazo = setTimeout(() => rejeitar(new Error('O Gemini Live não confirmou a sessão a tempo.')), ESPERA_DO_SETUP_MS);
      aoFicarPronto = () => {
        if (pronto) return;
        clearTimeout(prazo);
        pronto = true;
        const pendente = aberturaPendente;
        aberturaPendente = null;
        try {
          abrirConversa(typeof pendente === 'function' ? pendente() : pendente);
        } catch (erro) {
          console.warn('A abertura da sessão falhou; o Frank fica esperando o usuário falar.', erro);
        }
        resolver();
      };
      ws = new WebSocket(`${endereco}?access_token=${encodeURIComponent(token)}`);
      ws.binaryType = 'arraybuffer';
      // O token já traz voz, instruções e ferramentas: o setup do navegador manda só o modelo.
      ws.addEventListener('open', () => enviar({ setup: { model: modelo } }));
      ws.addEventListener('message', ({ data }) => tratarMensagem(data));
      ws.addEventListener('close', (evento) => {
        clearTimeout(prazo);
        if (!pronto) rejeitar(new Error(`O Gemini Live recusou a sessão: ${motivoDoFechamento(evento)}.`));
        finalizar(pedidoDeFechamento ? 'encerrada por você' : motivoDoFechamento(evento));
      });
    });
  }

  async function iniciar({ nome, voz, abertura }) {
    if (ws || microfone) throw new Error('A sessão do Gemini Live já foi iniciada.');
    aberturaPendente = abertura ?? null;
    const contexto = contextoDeAudio();
    const capturado = await navigator.mediaDevices.getUserMedia({ audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    if (finalizado) {
      capturado.getTracks().forEach((faixa) => faixa.stop());
      throw new Error('Sessão cancelada antes de conectar.');
    }
    microfone = capturado;
    medidorEntrada = medidorDeStream(microfone);
    const [credencial] = await Promise.all([
      api.json('/api/gemini/sessao', { metodo: 'POST', corpo: { nome, voz, fuso: fusoDoNavegador() }, timeoutMs: 25_000 }),
      carregarCapturador(contexto),
    ]);
    if (finalizado) throw new Error('Sessão cancelada antes de conectar.');

    saida = contexto.createGain();
    saida.connect(contexto.destination);
    medidorSaida = criarMedidor(saida);
    fonteDoMicrofone = contexto.createMediaStreamSource(microfone);
    capturador = new AudioWorkletNode(contexto, 'captura-do-microfone');
    capturador.port.onmessage = ({ data }) => {
      if (pronto && !mudo && !finalizado) enviar({ realtimeInput: { audio: { data: paraBase64(data), mimeType: 'audio/pcm;rate=16000' } } });
    };
    fonteDoMicrofone.connect(capturador);
    // A saída do capturador é silêncio; ligada ao destino, o nó segue no grafo que o navegador processa.
    capturador.connect(contexto.destination);
    if (contexto.state !== 'running') {
      aoErro({ mensagem: 'O navegador ainda não liberou o som do Frank. Clique na página para liberar.', fatal: false });
    }

    await conectar(credencial);
    vigiarFala();
  }

  return {
    iniciar,
    encerrar() {
      if (finalizado) return Promise.resolve();
      pedidoDeFechamento = true;
      const fechou = new Promise((resolver) => esperasDeFechamento.push(resolver));
      finalizar('encerrada por você');
      return fechou;
    },
    silenciar(valor) {
      mudo = valor;
      for (const faixa of microfone?.getAudioTracks() ?? []) faixa.enabled = !valor;
      if (valor) enviar({ realtimeInput: { audioStreamEnd: true } });
    },
    avisar(texto) {
      enviarTexto(`${ROTULOS_DO_PAINEL.aviso} ${texto}`);
    },
    // O pedido de autorização chega com o turno pausado no Hermes; o Frank pergunta, e o sim ou o não volta pela ferramenta.
    falarSobreTurno(_delegacaoId, texto) {
      if (finalizado || pedidoDeFechamento) return;
      enviarTexto(`${ROTULOS_DO_PAINEL.autorizacao} ${texto}`);
    },
    nivelEntrada: () => medidorEntrada?.nivel() ?? 0,
    nivelSaida: () => medidorSaida?.nivel() ?? 0,
    get conectado() {
      return pronto && !finalizado && ws?.readyState === WebSocket.OPEN;
    },
  };
}
