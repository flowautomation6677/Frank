// Microfone para o Gemini Live, que pede PCM de 16 bits a 16 kHz. O AudioContext roda a 44,1 ou 48 kHz: cada amostra
// de saída é a média da janela de entrada correspondente, e os blocos de 100 ms vão para a página como ArrayBuffer.
// A saída do nó fica em silêncio; ele só existe para capturar.
const TAXA_DE_DESTINO = 16_000;
const AMOSTRAS_POR_BLOCO = 1_600;

class CapturaDoMicrofone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.razao = sampleRate / TAXA_DE_DESTINO;
    this.fase = 0;
    this.soma = 0;
    this.quantas = 0;
    this.bloco = new Int16Array(AMOSTRAS_POR_BLOCO);
    this.posicao = 0;
  }

  guardar(valor) {
    const amostra = Math.max(-1, Math.min(1, valor));
    this.bloco[this.posicao] = amostra < 0 ? amostra * 0x8000 : amostra * 0x7fff;
    this.posicao += 1;
    if (this.posicao < AMOSTRAS_POR_BLOCO) return;
    this.port.postMessage(this.bloco.buffer, [this.bloco.buffer]);
    this.bloco = new Int16Array(AMOSTRAS_POR_BLOCO);
    this.posicao = 0;
  }

  process(entradas) {
    const canal = entradas[0]?.[0];
    if (!canal) return true;
    for (let indice = 0; indice < canal.length; indice += 1) {
      this.soma += canal[indice];
      this.quantas += 1;
      this.fase += 1;
      if (this.fase >= this.razao) {
        this.guardar(this.soma / this.quantas);
        this.soma = 0;
        this.quantas = 0;
        this.fase -= this.razao;
      }
    }
    return true;
  }
}

registerProcessor('captura-do-microfone', CapturaDoMicrofone);
