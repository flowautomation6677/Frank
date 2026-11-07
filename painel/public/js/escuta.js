// Escuta do chamado: com a voz dormindo, o reconhecimento de fala do Chrome (gratuito) espera alguém dizer "Frank".
// Ela para quando a sessão do GPT Live acorda, para não ouvir em dobro, e volta quando a sessão dorme.
import { temChamadoDoFrank } from './painel-logica.js';

// O Chrome encerra a escuta contínua de tempos em tempos, e ela volta sozinha. Fim rápido em sequência é laço (outra aba
// disputando o reconhecimento, que é um por navegador): depois de alguns, a escuta desiste e tenta de novo mais tarde.
const FIM_RAPIDO_MS = 1_000;
const MAXIMO_DE_FINS_RAPIDOS = 5;
const NOVA_TENTATIVA_MS = 30_000;
const RELOGIO_REAL = { agendar: (tarefa, ms) => setTimeout(tarefa, ms), cancelar: (id) => clearTimeout(id) };

export function reconhecimentoDoNavegador(janela = globalThis) {
  const Classe = janela.SpeechRecognition ?? janela.webkitSpeechRecognition;
  return Classe ? () => new Classe() : null;
}

// Estados: desligada; indisponivel (navegador sem reconhecimento de fala); bloqueada (microfone negado); iniciando;
// ouvindo; falhou (rede ou microfone ocupado, com nova tentativa sozinha).
export function criarEscutaDoChamado({ criarReconhecimento, aoChamar, aoMudar = () => {}, relogio = RELOGIO_REAL, agora = () => Date.now(), idioma = 'pt-BR' }) {
  let querOuvir = false;
  let atual = null;
  let estado = 'desligada';
  let inicioEm = 0;
  let finsRapidos = 0;
  let agendado = null;

  function mudar(novo) {
    if (novo === estado) return;
    estado = novo;
    aoMudar(estado);
  }

  function cancelarAgendado() {
    if (agendado === null) return;
    relogio.cancelar(agendado);
    agendado = null;
  }

  function agendarInicio(ms) {
    agendado = relogio.agendar(() => {
      agendado = null;
      iniciar();
    }, ms);
  }

  // abort, e não stop: nenhum resultado final atrasado chega depois que a escuta decidiu parar.
  function soltarAtual() {
    const reconhecimento = atual;
    atual = null;
    try {
      reconhecimento?.abort();
    } catch {
      // O reconhecimento já tinha parado.
    }
  }

  function parar(final) {
    querOuvir = false;
    cancelarAgendado();
    soltarAtual();
    mudar(final);
  }

  function tentarMaisTarde() {
    soltarAtual();
    mudar('falhou');
    agendarInicio(NOVA_TENTATIVA_MS);
  }

  function tratarResultado(evento) {
    const resultados = evento?.results ?? [];
    for (let indice = evento?.resultIndex ?? 0; indice < resultados.length; indice += 1) {
      const resultado = resultados[indice];
      if (!resultado?.isFinal) continue;
      const fala = String(resultado[0]?.transcript ?? '').replace(/\s+/g, ' ').trim();
      if (!temChamadoDoFrank(fala)) continue;
      // O microfone fica livre para a sessão do GPT Live antes de o painel acordá-la.
      parar('desligada');
      aoChamar(fala);
      return;
    }
  }

  // Só chega aqui o fim do reconhecimento em uso: parar() solta o atual, e o onend dele é ignorado.
  function tratarFim() {
    atual = null;
    finsRapidos = agora() - inicioEm < FIM_RAPIDO_MS ? finsRapidos + 1 : 0;
    if (finsRapidos >= MAXIMO_DE_FINS_RAPIDOS) {
      finsRapidos = 0;
      tentarMaisTarde();
    } else if (finsRapidos === 0) {
      iniciar();
    } else {
      agendarInicio(FIM_RAPIDO_MS * finsRapidos);
    }
  }

  function iniciar() {
    if (!querOuvir || atual) return;
    let reconhecimento = null;
    try {
      reconhecimento = criarReconhecimento?.() ?? null;
    } catch (erro) {
      console.warn('O reconhecimento de fala do navegador não abriu.', erro);
    }
    if (!reconhecimento) {
      parar('indisponivel');
      return;
    }
    reconhecimento.lang = idioma;
    reconhecimento.continuous = true;
    reconhecimento.interimResults = true;
    reconhecimento.onstart = () => {
      if (reconhecimento === atual) mudar('ouvindo');
    };
    reconhecimento.onresult = (evento) => {
      if (reconhecimento === atual) tratarResultado(evento);
    };
    reconhecimento.onerror = (evento) => {
      if (reconhecimento !== atual) return;
      const erro = evento?.error;
      if (erro === 'not-allowed' || erro === 'service-not-allowed') parar('bloqueada');
      else if (erro === 'language-not-supported') parar('indisponivel');
      else if (erro === 'network' || erro === 'audio-capture') tentarMaisTarde();
      // no-speech e aborted: o onend que chega logo depois reinicia a escuta.
    };
    reconhecimento.onend = () => {
      if (reconhecimento === atual) tratarFim();
    };
    atual = reconhecimento;
    inicioEm = agora();
    mudar('iniciando');
    try {
      reconhecimento.start();
    } catch (erro) {
      console.warn('A escuta do chamado não começou.', erro);
      tentarMaisTarde();
    }
  }

  return {
    ligar() {
      if (querOuvir) return;
      querOuvir = true;
      finsRapidos = 0;
      iniciar();
    },
    desligar() {
      if (!querOuvir && !atual && agendado === null) return;
      parar('desligada');
    },
    estado: () => estado,
    get escutando() {
      return estado === 'ouvindo';
    },
  };
}
