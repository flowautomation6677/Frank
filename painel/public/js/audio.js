let contexto = null;

export function contextoDeAudio() {
  if (!contexto) contexto = new AudioContext();
  if (contexto.state === 'suspended') {
    contexto.resume().catch((erro) => console.warn('O navegador ainda não liberou o áudio.', erro));
  }
  return contexto;
}

export async function audioLiberado() {
  const atual = contextoDeAudio();
  if (atual.state === 'running') return true;
  await Promise.race([atual.resume(), new Promise((resolver) => setTimeout(resolver, 400))]);
  return atual.state === 'running';
}

export function criarMedidor(fonte) {
  const analisador = fonte.context.createAnalyser();
  analisador.fftSize = 1024;
  fonte.connect(analisador);
  let ligado = true;
  const amostras = new Float32Array(analisador.fftSize);
  return {
    nivel() {
      analisador.getFloatTimeDomainData(amostras);
      let soma = 0;
      for (const valor of amostras) soma += valor * valor;
      return Math.min(1, Math.sqrt(soma / amostras.length) * 5);
    },
    // Pode vir depois de um fonte.disconnect() sem destino, que já tirou o analisador: aí o disconnect(analisador)
    // lança InvalidAccessError. Desligar duas vezes também não faz nada.
    desligar() {
      if (!ligado) return;
      ligado = false;
      try {
        fonte.disconnect(analisador);
      } catch {
        // A fonte já tinha saído do grafo inteira.
      }
    },
  };
}

export function medidorDeStream(stream) {
  return criarMedidor(contextoDeAudio().createMediaStreamSource(stream));
}

export function mensagemDoMicrofone(erro) {
  if (erro?.name === 'NotAllowedError' || erro?.name === 'SecurityError') {
    return 'O navegador bloqueou o microfone. Libere o acesso no cadeado da barra de endereço e tente de novo.';
  }
  if (erro?.name === 'NotFoundError' || erro?.name === 'OverconstrainedError') {
    return 'Nenhum microfone encontrado neste computador.';
  }
  if (erro?.name === 'NotReadableError') {
    return 'O microfone está ocupado por outro programa. Feche o outro uso e tente de novo.';
  }
  return null;
}
