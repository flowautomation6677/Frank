// Número na legenda sai em algarismo: a voz fala "cinco ponto cinco" e a transcrição
// escreve por extenso, mas a tela mostra "5.5". Só o texto da tela muda; a fala e o histórico ficam como vieram.
// Ficam por extenso o "um" e o "uma" de artigo, o "zero" de "do zero", o "mil" de "mil vezes" e o "dois" de "os dois".

// [valor, ordem]: a ordem é a menor casa que a palavra ocupa. Numa sequência ("cento e vinte e cinco") a ordem só desce.
const VALORES = new Map(Object.entries({
  zero: [0, 1], um: [1, 1], uma: [1, 1], dois: [2, 1], duas: [2, 1], tres: [3, 1], quatro: [4, 1], cinco: [5, 1],
  seis: [6, 1], sete: [7, 1], oito: [8, 1], nove: [9, 1],
  dez: [10, 1], onze: [11, 1], doze: [12, 1], treze: [13, 1], catorze: [14, 1], quatorze: [14, 1], quinze: [15, 1],
  dezesseis: [16, 1], dezasseis: [16, 1], dezessete: [17, 1], dezassete: [17, 1], dezoito: [18, 1], dezenove: [19, 1], dezanove: [19, 1],
  vinte: [20, 10], trinta: [30, 10], quarenta: [40, 10], cinquenta: [50, 10], sessenta: [60, 10], setenta: [70, 10],
  oitenta: [80, 10], noventa: [90, 10],
  cem: [100, 100], cento: [100, 100], duzentos: [200, 100], duzentas: [200, 100], trezentos: [300, 100], trezentas: [300, 100],
  quatrocentos: [400, 100], quatrocentas: [400, 100], quinhentos: [500, 100], quinhentas: [500, 100],
  seiscentos: [600, 100], seiscentas: [600, 100], setecentos: [700, 100], setecentas: [700, 100],
  oitocentos: [800, 100], oitocentas: [800, 100], novecentos: [900, 100], novecentas: [900, 100],
}));
const SOZINHAS_POR_EXTENSO = new Set(['um', 'uma', 'zero', 'mil']);
const PEQUENOS = new Set(['dois', 'duas', 'tres']);
// Antes de "dois", "duas" ou "três", estas palavras fazem dele pronome ("nenhum dos dois"). "Às" fica de fora: "às duas" é hora.
const ANTES_DO_PRONOME = new Set(['os', 'as', 'dos', 'das', 'nos', 'nas', 'aos', 'nós', 'vocês', 'eles', 'elas', 'esses', 'essas', 'estes', 'estas', 'aqueles', 'aquelas', 'todos', 'todas']);
const ESCALAS = new Set(['milhao', 'milhoes', 'bilhao', 'bilhoes', 'trilhao', 'trilhoes']);
const MILHAR = new Intl.NumberFormat('pt-BR');

const semAcento = (texto) => texto.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

export function numerosEmAlgarismos(texto) {
  const pedacos = String(texto ?? '').match(/[\p{L}\p{M}]+|[^\p{L}\p{M}]+/gu) ?? [];
  const ehPalavra = (i) => i >= 0 && i < pedacos.length && /^\p{L}/u.test(pedacos[i]);
  const palavra = (i) => (ehPalavra(i) ? semAcento(pedacos[i]) : null);
  const soEspaco = (i) => i >= 0 && i < pedacos.length && /^\s+$/.test(pedacos[i]);
  // Palavra seguinte à do índice i, separada dela só por espaço; -1 quando há pontuação no meio ou o texto acabou.
  const seguinte = (i) => (soEspaco(i + 1) && ehPalavra(i + 2) ? i + 2 : -1);
  const anterior = (i) => (soEspaco(i - 1) && ehPalavra(i - 2) ? pedacos[i - 2].toLowerCase() : null);
  const ehNumero = (i) => VALORES.has(palavra(i)) || palavra(i) === 'mil';

  function lerInteiro(inicio) {
    let milhares = 0;
    let atual = 0;
    let ultimaOrdem = Infinity;
    let comMil = false;
    let fim = -1;
    let palavras = 0;
    let j = inicio;
    for (;;) {
      const atualPalavra = palavra(j);
      if (atualPalavra === 'mil') {
        if (comMil) break;
        milhares = (atual || 1) * 1000;
        atual = 0;
        ultimaOrdem = 1000;
        comMil = true;
      } else if (VALORES.has(atualPalavra)) {
        const [valor, ordem] = VALORES.get(atualPalavra);
        if (ordem >= ultimaOrdem) break;
        atual += valor;
        ultimaOrdem = ordem;
      } else {
        break;
      }
      fim = j;
      palavras += 1;
      const proxima = seguinte(j);
      if (proxima < 0) break;
      if (palavra(proxima) === 'e') {
        const depoisDoE = seguinte(proxima);
        if (depoisDoE < 0 || !VALORES.has(palavra(depoisDoE))) break;
        j = depoisDoE;
      } else {
        j = proxima;
      }
    }
    return fim < 0 ? null : { valor: milhares + atual, resto: atual, comMil, fim, palavras };
  }

  function emAlgarismos({ valor, resto, comMil }) {
    if (comMil && resto === 0) return `${valor / 1000} mil`;
    return valor >= 10_000 ? MILHAR.format(valor) : String(valor);
  }

  function lerNumero(inicio) {
    if (!ehNumero(inicio)) return null;
    if (palavra(inicio) === 'cento' && anterior(inicio) === 'por') return null;
    const inteiro = lerInteiro(inicio);
    if (!inteiro) return null;
    let fim = inteiro.fim;
    let numero = String(inteiro.valor);
    let especial = false;

    // "cinco ponto cinco" e "dois ponto um ponto três" (versão); "três vírgula sete" (decimal).
    for (;;) {
      const separador = seguinte(fim);
      const qual = palavra(separador);
      if (qual !== 'ponto' && qual !== 'virgula') break;
      const parte = seguinte(separador) >= 0 ? lerInteiro(seguinte(separador)) : null;
      if (!parte || parte.comMil) break;
      numero += `${qual === 'ponto' ? '.' : ','}${parte.valor}`;
      fim = parte.fim;
      especial = true;
    }

    const depois = seguinte(fim);
    const depoisDoE = seguinte(depois);
    if (palavra(depois) === 'por' && palavra(depoisDoE) === 'cento') {
      numero += '%';
      fim = depoisDoE;
      especial = true;
    } else if (!especial && !inteiro.comMil && inteiro.valor >= 1 && inteiro.valor <= 23 && palavra(depois) === 'e' && palavra(depoisDoE) === 'meia') {
      numero = `${inteiro.valor}h30`;
      fim = depoisDoE;
      especial = true;
    } else if (ESCALAS.has(palavra(depois))) {
      especial = true;
    }

    if (!especial && inteiro.palavras === 1) {
      const sozinha = palavra(inicio);
      if (SOZINHAS_POR_EXTENSO.has(sozinha)) return null;
      if (PEQUENOS.has(sozinha) && ANTES_DO_PRONOME.has(anterior(inicio))) return null;
    }
    return { texto: especial ? numero : emAlgarismos(inteiro), depois: fim + 1 };
  }

  const saida = [];
  let i = 0;
  while (i < pedacos.length) {
    const lido = lerNumero(i);
    if (lido) {
      saida.push(lido.texto);
      i = lido.depois;
    } else {
      saida.push(pedacos[i]);
      i += 1;
    }
  }
  return saida.join('');
}
