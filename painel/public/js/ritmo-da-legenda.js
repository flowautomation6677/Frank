// A legenda do Frank acompanha a voz: a transcrição chega antes do som, e mostrar na chegada põe o fim da frase na tela
// enquanto ele ainda fala o começo. O texto sai na proporção do áudio já tocado (Gemini Live, que sabe a duração de
// cada trecho) ou no ritmo da fala enquanto a voz está saindo (GPT Live).

// Ritmo de leitura em voz alta em português, para os motores que não dão a duração do áudio.
export const CARACTERES_POR_SEGUNDO = 15;
// A voz parou há mais que isso: a fala acabou, e o que sobrou da transcrição aparece de uma vez.
export const FIM_DA_FALA_MS = 1200;

// Até o fim da última palavra inteira antes de ate, para a legenda nunca mostrar meia palavra.
function fimDePalavra(texto, ate) {
  if (ate >= texto.length) return texto.length;
  const espaco = texto.lastIndexOf(' ', ate);
  return espaco < 0 ? 0 : espaco + 1;
}

// aoMostrar(trecho): o pedaço novo que a legenda mostra. tique({ tocado, total }): tocado são os segundos de voz já
// ouvidos desta fala; total, os segundos de áudio que a fala tem até agora, quando o motor sabe (senão, o ritmo fixo).
export function criarRitmoDaLegenda({ aoMostrar, caracteresPorSegundo = CARACTERES_POR_SEGUNDO }) {
  let texto = '';
  let mostrado = 0;

  function soltar(ate) {
    const fim = Math.max(mostrado, fimDePalavra(texto, Math.floor(ate)));
    if (fim <= mostrado) return;
    aoMostrar(texto.slice(mostrado, fim));
    mostrado = fim;
  }

  return {
    receber(trecho) {
      if (trecho) texto += trecho;
    },
    tique({ tocado, total = null }) {
      if (mostrado >= texto.length) return;
      soltar(total ? texto.length * Math.min(1, tocado / total) : tocado * caracteresPorSegundo);
    },
    // A fala acabou: o resto aparece e a próxima começa do zero.
    terminar() {
      soltar(texto.length);
      texto = '';
      mostrado = 0;
    },
    // A fala foi interrompida: o que ele não chegou a dizer não aparece.
    cortar() {
      texto = '';
      mostrado = 0;
    },
    get pendente() {
      return texto.length - mostrado;
    },
  };
}

// Para motores sem a duração do áudio: falando(valor) a cada mudança da voz e tique() de tempos em tempos.
export function criarRitmoPorVoz({ aoMostrar, agora = () => Date.now() }) {
  const ritmo = criarRitmoDaLegenda({ aoMostrar });
  let falandoDesde = 0;
  let acumuladoMs = 0;
  let ultimoSinal = 0;

  return {
    receber(trecho) {
      ritmo.receber(trecho);
      ultimoSinal = agora();
    },
    falando(valor) {
      const momento = agora();
      if (valor && !falandoDesde) falandoDesde = momento;
      if (!valor && falandoDesde) {
        acumuladoMs += momento - falandoDesde;
        falandoDesde = 0;
      }
      ultimoSinal = momento;
    },
    tique() {
      const momento = agora();
      if (!falandoDesde && momento - ultimoSinal >= FIM_DA_FALA_MS) {
        if (ritmo.pendente > 0 || acumuladoMs > 0) ritmo.terminar();
        acumuladoMs = 0;
        return;
      }
      if (ritmo.pendente > 0) ritmo.tique({ tocado: (acumuladoMs + (falandoDesde ? momento - falandoDesde : 0)) / 1000 });
    },
    // O motor sabe que a fala acabou: o resto aparece já.
    terminar() {
      ritmo.terminar();
      acumuladoMs = 0;
      falandoDesde = 0;
    },
    cortar() {
      ritmo.cortar();
      acumuladoMs = 0;
      falandoDesde = 0;
    },
  };
}
