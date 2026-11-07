const POSICOES_NO_ARCO = [
  [-1, 0.62], [-1, -0.08], [-0.62, -0.7], [0, -1], [0.62, -0.7], [1, -0.08], [1, 0.62],
];
const MARGEM = 16;
const MARCAS_DE_ESCALA = 120;
const BARRAS_DE_VOZ = 64;
const DURACAO_PULSO_MS = 1100;
const DURACAO_DESTAQUE_MS = 1200;
const DURACAO_DO_IMPACTO_MS = 160;
// Acordar: o núcleo dispara energia para os 7 agentes em varredura pelo arco.
const ATRASO_DO_DESPERTAR_MS = 180;
const INTERVALO_DO_DESPERTAR_MS = 115;
const DURACAO_DO_PULSO_DE_DESPERTAR_MS = 560;
// Energia contínua com a sessão ativa: voltas por segundo de cada partícula.
const VELOCIDADE_DA_ENERGIA = 0.11;
const ACELERACAO_NA_FALA = 0.6;
// Ordem do organograma da página B: quatro em cima, três embaixo, intercalados.
const VAGAS_NO_RETRATO = { renata: [0, 0], breno: [0, 1], marina: [0, 2], lara: [0, 3], vitor: [1, 0], ulisses: [1, 1], isabela: [1, 2] };
const ORDEM_DOS_AGENTES = ['ulisses', 'isabela', 'renata', 'marina', 'lara', 'breno', 'vitor'];
const BASE_DA_LEGENDA = 26;
const FOLGA_DA_LEGENDA = 16;
const ALTURA_MAXIMA_DA_LEGENDA = 168;
const LARGURA_MAXIMA_DA_LEGENDA = 900;
// Bordas, respiro, rótulo de quem fala e o espaço até o texto, somados (ver .legendas no CSS).
const MOLDURA_DA_LEGENDA = 38;
const ALTURA_DA_LINHA_DA_LEGENDA = 1.35;
// Espaço que o botão do cta ocupa no pé do quadro quando aparece.
const RESERVA_DO_CTA = 74;
// Largura mínima, em px, para a legenda caber no vão entre os cartões de baixo com 10 palavras por linha.
const VAO_MINIMO_DA_LEGENDA = 700;
// Abaixo disso a faixa de baixo não comporta duas linhas: a legenda volta para o vão entre os cartões.
const ALTURA_MINIMA_DA_FAIXA = 80;
// Abaixo disso os cartões encostam no anel do núcleo; 800 é a folga do arco na vista do operador em 1440.
const LARGURA_MINIMA_DO_ARCO = 800;
const DURACAO_DA_RESERVA_MS = 600;

function paraRgba(cor, alfa) {
  const texto = cor.trim();
  if (texto.startsWith('#')) {
    const hex = texto.length === 4 ? texto.slice(1).split('').map((c) => c + c).join('') : texto.slice(1, 7);
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alfa})`;
  }
  const numeros = texto.match(/[\d.]+/g) ?? ['0', '0', '0', '1'];
  const base = Number(numeros[3] ?? 1);
  return `rgba(${numeros[0]}, ${numeros[1]}, ${numeros[2]}, ${base * alfa})`;
}

function lerCores() {
  const estilo = getComputedStyle(document.documentElement);
  const ler = (nome) => estilo.getPropertyValue(nome).trim();
  const acento = ler('--hud-acento');
  return {
    traco: ler('--hud-traco'),
    acento,
    brilho: ler('--hud-brilho') || acento,
    calor: ler('--hud-calor') || acento,
    entrada: ler('--hud-entrada'),
    alerta: ler('--alerta-texto'),
    claro: document.documentElement.dataset.tema === 'claro',
  };
}

function suavizar(atual, alvo, dtMs) {
  const taxa = alvo > atual ? 0.45 : 0.12;
  return atual + (alvo - atual) * (1 - (1 - taxa) ** (dtMs / 16.7));
}

function curva(t, p0, c, p1) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
}

function suave(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function larguraDaAba(largura) {
  return Math.max(0, Math.min(780, Math.max(480, largura * 0.44), largura - LARGURA_MINIMA_DO_ARCO));
}

export function criarHud({ palco, area, canvas, cartoes, obterNiveis, obterQuadro, aoAcender, aoApagar }) {
  const pincel = canvas.getContext('2d');
  const movimentoReduzido = matchMedia('(prefers-reduced-motion: reduce)');
  const estadoDoFrank = palco.querySelector('.estado-frank');
  let geometria = null;
  let cores = lerCores();
  let pulsos = [];
  let nivelEntrada = 0;
  let nivelSaida = 0;
  let angulo = 0;
  let ultimoQuadro = performance.now();
  let pedidoDeLayout = 0;
  let quadroAnimacao = 0;
  let destaque = -Infinity;
  let energia = 0;
  let faseDaEnergia = 0;
  const despertares = new Set();
  const medidas = { largura: 0, altura: 0, escala: 0 };
  // Faixa à direita que o palco cede para a aba de cenas: anima de "de" para "alvo".
  const reserva = { ligada: false, atual: 0, de: 0, alvo: 0, inicio: 0 };
  const variaveis = new Map();

  function definirVariavel(nome, valor) {
    if (variaveis.get(nome) === valor) return;
    variaveis.set(nome, valor);
    if (valor === null) palco.style.removeProperty(nome);
    else palco.style.setProperty(nome, valor);
  }

  function caminhoDaLinha(ancora) {
    const { cx, cy, R } = geometria;
    if (geometria.retrato) {
      const inicio = { x: cx, y: cy + R * 1.08 };
      return { inicio, controle: { x: ancora.x, y: inicio.y + (ancora.y - inicio.y) * 0.45 }, fim: ancora };
    }
    const dx = ancora.x - cx;
    const dy = ancora.y - cy;
    const distancia = Math.hypot(dx, dy) || 1;
    const inicio = { x: cx + (dx / distancia) * R * 1.03, y: cy + (dy / distancia) * R * 1.03 };
    const meio = { x: (inicio.x + ancora.x) / 2, y: (inicio.y + ancora.y) / 2 };
    const dobra = (dx < 0 ? -1 : 1) * 0.12 * distancia;
    return { inicio, controle: { x: meio.x - (dy / distancia) * dobra, y: meio.y + (dx / distancia) * dobra }, fim: ancora };
  }

  function posicoesNoArco(larguraUtil, altura, elementos) {
    const larguraCartao = elementos[0].offsetWidth;
    const alturaCartao = Math.max(...elementos.map((elemento) => elemento.offsetHeight));
    const cx = larguraUtil / 2;
    const cy = altura * 0.45;
    const R = Math.max(72, Math.min(larguraUtil * 0.17, altura * 0.19, 175));
    const alcanceX = larguraUtil / 2 - MARGEM - larguraCartao / 2;
    const alcanceY = cy - MARGEM - alturaCartao / 2;
    const posicoes = POSICOES_NO_ARCO.map(([u, v]) => ({ x: cx + u * alcanceX, y: cy + v * alcanceY }));
    const topo = posicoes[3];
    const encostaNoNucleo = ({ x, y }) => {
      const dx = Math.max(Math.abs(x - cx) - larguraCartao / 2, 0);
      const dy = Math.max(Math.abs(y - cy) - alturaCartao / 2, 0);
      return Math.hypot(dx, dy) < R + 12;
    };
    for (const indice of [2, 4]) {
      if (Math.abs(posicoes[indice].x - topo.x) >= larguraCartao + 8) continue;
      // Perto do cartão do topo, desce para baixo dele; se aí bater no anel do núcleo (arco estreito e baixo), fica ao lado.
      const empurrado = { x: posicoes[indice].x, y: Math.max(posicoes[indice].y, topo.y + alturaCartao + 10) };
      const lado = indice === 2 ? -1 : 1;
      const aoLado = { x: topo.x + lado * (larguraCartao + 8), y: posicoes[indice].y };
      posicoes[indice] = encostaNoNucleo(empurrado) ? aoLado : empurrado;
    }
    return { cx, cy, R, posicoes };
  }

  function baseDaLegenda() {
    const valor = Number.parseFloat(getComputedStyle(palco).getPropertyValue('--leg-base'));
    return Number.isFinite(valor) ? valor : BASE_DA_LEGENDA;
  }

  // Quantas linhas inteiras de legenda cabem numa altura: a caixa nunca mostra meia linha cortada.
  function linhasQueCabem(altura) {
    const texto = palco.querySelector('.legenda-frank .legenda-texto');
    const fonte = texto ? Number.parseFloat(getComputedStyle(texto).fontSize) : 22;
    return Math.max(1, Math.min(3, Math.floor((altura - MOLDURA_DA_LEGENDA) / (fonte * ALTURA_DA_LINHA_DA_LEGENDA))));
  }

  // A legenda fica na faixa de baixo, centrada no palco inteiro, abaixo dos cartões e da linha de estado.
  // É calculada sem a reserva da aba: não muda de largura nem quebra linha de novo enquanto o palco desliza.
  function legendaNoArco(largura, altura, elementos, cheio) {
    const base = baseDaLegenda();
    const alturaDoEstado = estadoDoFrank?.offsetHeight ?? 0;
    const caixas = cheio.posicoes.map((posicao, indice) => ({
      esquerda: posicao.x - elementos[indice].offsetWidth / 2,
      direita: posicao.x + elementos[indice].offsetWidth / 2,
      fundo: posicao.y + elementos[indice].offsetHeight / 2,
    }));
    const fundoDoEstado = cheio.cy + cheio.R + (alturaDoEstado ? 16 + alturaDoEstado + 12 : 12);
    const vao = (caixas[6].esquerda - FOLGA_DA_LEGENDA) - (caixas[0].direita + FOLGA_DA_LEGENDA);
    const larguraDaFaixa = Math.min(LARGURA_MAXIMA_DA_LEGENDA, Math.max(largura * 0.76, Math.min(largura - 2 * MARGEM, 640)));
    const larguraDaCaixa = vao >= VAO_MINIMO_DA_LEGENDA ? Math.min(larguraDaFaixa, vao) : larguraDaFaixa;
    // Com a aba aberta qualquer cartão pode deslizar para baixo da caixa: o limite conta todos.
    const topoComAba = Math.max(...caixas.map((caixa) => caixa.fundo), fundoDoEstado) + FOLGA_DA_LEGENDA;
    // Com o palco centrado (como no cta), só contam os cartões que ficam embaixo da caixa.
    const esquerda = largura / 2 - larguraDaCaixa / 2;
    const direita = largura / 2 + larguraDaCaixa / 2;
    const embaixo = caixas.filter((caixa) => caixa.direita > esquerda && caixa.esquerda < direita).map((caixa) => caixa.fundo);
    const topoCentrado = Math.max(...embaixo, fundoDoEstado) + FOLGA_DA_LEGENDA;
    if (altura - base - topoComAba >= ALTURA_MINIMA_DA_FAIXA) {
      return { x: largura / 2, largura: larguraDaCaixa, alturaMaxima: altura - base - topoComAba, alturaLivre: altura - base - topoCentrado, base };
    }
    const vaoEsquerda = caixas[0].direita + FOLGA_DA_LEGENDA;
    const vaoDireita = caixas[6].esquerda - FOLGA_DA_LEGENDA;
    const alturaDoVao = altura - base - fundoDoEstado;
    return { x: (vaoEsquerda + vaoDireita) / 2, largura: vaoDireita - vaoEsquerda, alturaMaxima: alturaDoVao, alturaLivre: alturaDoVao, base };
  }

  function relayout() {
    const largura = area.clientWidth;
    const altura = area.clientHeight;
    if (!largura || !altura) return;
    const escala = Math.min(2, window.devicePixelRatio || 1);
    if (largura !== medidas.largura || altura !== medidas.altura || escala !== medidas.escala) {
      Object.assign(medidas, { largura, altura, escala });
      canvas.width = Math.round(largura * escala);
      canvas.height = Math.round(altura * escala);
      pincel.setTransform(escala, 0, 0, escala, 0, 0);
    }

    const elementos = cartoes();
    const retrato = palco.dataset.quadro === 'retrato' && elementos.length > 0;
    const emArco = !retrato && elementos.length > 0 && getComputedStyle(elementos[0]).position === 'absolute';
    const larguraReservada = larguraDaAba(largura);
    const alvoAtual = reserva.ligada ? larguraReservada : 0;
    if (reserva.atual === reserva.alvo && reserva.alvo !== alvoAtual) Object.assign(reserva, { atual: alvoAtual, de: alvoAtual, alvo: alvoAtual });
    definirVariavel('--aba-reserva', `${larguraReservada}px`);
    let cx = largura / 2;
    let cy;
    let R;
    let ancoras = [];
    let legenda = null;

    if (retrato) {
      const alturaCartao = Math.max(...elementos.map((elemento) => elemento.offsetHeight));
      cy = altura * 0.24;
      R = Math.max(56, Math.min(largura * 0.21, altura * 0.13));
      let primeiraFileira = Math.max(cy + R * 1.5 + alturaCartao / 2, altura * 0.5);
      let segundaFileira = primeiraFileira + alturaCartao + Math.max(14, altura * 0.02);
      if (palco.dataset.cta === 'sim') {
        const alturaCta = palco.querySelector('.cena-cta')?.offsetHeight || 58;
        definirVariavel('--cta-altura', `${alturaCta}px`);
        // A legenda e o CTA têm uma faixa própria: núcleo e fileiras sobem juntos para liberar esse espaço.
        const faixaInferior = altura * 0.04 + alturaCta + 12 + 56 + FOLGA_DA_LEGENDA;
        const subida = Math.max(0, segundaFileira + alturaCartao / 2 - (altura - faixaInferior));
        cy -= subida;
        primeiraFileira -= subida;
        segundaFileira -= subida;
      }
      const posicoes = ORDEM_DOS_AGENTES.map((id) => {
        const [fileira, coluna] = VAGAS_NO_RETRATO[id];
        return fileira === 0
          ? { x: largura * (0.125 + coluna * 0.25), y: primeiraFileira }
          : { x: largura * (0.25 + coluna * 0.25), y: segundaFileira };
      });
      elementos.forEach((elemento, indice) => {
        elemento.style.left = `${posicoes[indice].x}px`;
        elemento.style.top = `${posicoes[indice].y}px`;
      });
      ancoras = posicoes.map((posicao, indice) => ({ x: posicao.x, y: posicao.y - elementos[indice].offsetHeight / 2 }));
      const topoLivre = segundaFileira + alturaCartao / 2 + FOLGA_DA_LEGENDA;
      const base = baseDaLegenda();
      legenda = { x: cx, largura: largura * 0.92, alturaMaxima: altura - base - topoLivre, alturaLivre: altura - base - topoLivre, base };
    } else if (emArco) {
      const cheio = posicoesNoArco(largura, altura, elementos);
      const atual = reserva.atual > 0 ? posicoesNoArco(largura - reserva.atual, altura, elementos) : cheio;
      ({ cx, cy, R } = atual);
      const { posicoes } = atual;
      elementos.forEach((elemento, indice) => {
        elemento.style.left = `${posicoes[indice].x}px`;
        elemento.style.top = `${posicoes[indice].y}px`;
      });
      legenda = legendaNoArco(largura, altura, elementos, cheio);
      ancoras = posicoes.map((posicao, indice) => {
        const dx = cx - posicao.x;
        const dy = cy - posicao.y;
        const meiaLargura = elementos[indice].offsetWidth / 2;
        const meiaAltura = elementos[indice].offsetHeight / 2;
        const t = Math.min(meiaLargura / (Math.abs(dx) || 1e-6), meiaAltura / (Math.abs(dy) || 1e-6));
        return { x: posicao.x + dx * t, y: posicao.y + dy * t };
      });
    } else {
      for (const elemento of elementos) {
        elemento.style.left = '';
        elemento.style.top = '';
      }
      cy = altura / 2;
      R = Math.max(72, Math.min(largura * 0.36, altura * 0.42, 150));
    }

    geometria = { emArco: emArco || retrato, retrato, largura, altura, cx, cy, R, ancoras };
    definirVariavel('--nx', `${cx}px`);
    definirVariavel('--ny', `${cy}px`);
    definirVariavel('--nr', `${R * 0.46}px`);
    definirVariavel('--nR', `${R}px`);
    palco.dataset.layout = retrato ? 'retrato' : emArco ? 'arco' : 'empilhado';
    const nomesDaLegenda = ['--leg-x', '--leg-w', '--leg-max', '--leg-reserva', '--leg-linhas', '--leg-max-cta', '--leg-linhas-cta'];
    if (legenda) {
      const alturaMaxima = Math.max(72, Math.min(ALTURA_MAXIMA_DA_LEGENDA, legenda.alturaMaxima));
      const alturaNoCta = Math.max(56, Math.min(ALTURA_MAXIMA_DA_LEGENDA, Math.max(legenda.alturaMaxima, legenda.alturaLivre) - RESERVA_DO_CTA));
      definirVariavel('--leg-x', `${legenda.x}px`);
      definirVariavel('--leg-w', `${Math.max(180, legenda.largura)}px`);
      definirVariavel('--leg-max', `${alturaMaxima}px`);
      definirVariavel('--leg-reserva', `${legenda.base + alturaMaxima + 12}px`);
      definirVariavel('--leg-linhas', String(linhasQueCabem(alturaMaxima)));
      definirVariavel('--leg-max-cta', `${alturaNoCta}px`);
      definirVariavel('--leg-linhas-cta', String(linhasQueCabem(alturaNoCta)));
    } else {
      for (const nome of nomesDaLegenda) definirVariavel(nome, null);
    }
  }

  function animarReserva(agoraMs) {
    if (reserva.atual === reserva.alvo) return;
    const fracao = Math.min(1, Math.max(0, (agoraMs - reserva.inicio) / DURACAO_DA_RESERVA_MS));
    reserva.atual = fracao >= 1 ? reserva.alvo : reserva.de + (reserva.alvo - reserva.de) * suave(fracao);
    relayout();
  }

  function agendarLayout() {
    cancelAnimationFrame(pedidoDeLayout);
    pedidoDeLayout = requestAnimationFrame(relayout);
  }

  function definirBrilho(blur, alfaDaSombra = 0.95) {
    pincel.globalCompositeOperation = cores.claro ? 'source-over' : 'lighter';
    pincel.shadowColor = paraRgba(cores.brilho, cores.claro ? 0.45 : alfaDaSombra);
    pincel.shadowBlur = cores.claro ? blur * 0.5 : blur;
  }

  // Halo em camada: uma passada larga com sombra e soma de luz, depois o traço nítido por cima.
  function tracarComBrilho(caminho, { cor, alfa, largura, blur, alfaHalo = alfa * 0.5, larguraHalo = largura * 2.6 }) {
    pincel.save();
    definirBrilho(blur);
    pincel.strokeStyle = paraRgba(cor, alfaHalo);
    pincel.lineWidth = larguraHalo;
    pincel.stroke(caminho);
    pincel.restore();
    pincel.strokeStyle = paraRgba(cor, alfa);
    pincel.lineWidth = largura;
    pincel.stroke(caminho);
  }

  function preencherComBrilho(caminho, { cor, alfa, blur }) {
    pincel.save();
    definirBrilho(blur);
    pincel.fillStyle = paraRgba(cor, alfa);
    pincel.fill(caminho);
    pincel.restore();
  }

  function desenharLinhas(quadro, agoraMs, reduzido) {
    const grupos = { livre: new Path2D(), trabalhando: new Path2D(), entregue: new Path2D() };
    geometria.ancoras.forEach((ancora, indice) => {
      const { inicio, controle, fim } = caminhoDaLinha(ancora);
      const caminho = grupos[quadro.status[indice]] ?? grupos.livre;
      caminho.moveTo(inicio.x, inicio.y);
      caminho.quadraticCurveTo(controle.x, controle.y, fim.x, fim.y);
    });
    pincel.lineCap = 'butt';
    pincel.setLineDash([2, 6]);
    pincel.lineDashOffset = 0;
    if (energia < 0.98) {
      pincel.strokeStyle = paraRgba(cores.traco, 0.75 * (1 - energia));
      pincel.lineWidth = 1;
      pincel.stroke(grupos.livre);
    }
    // Com a sessão ativa, as linhas dos agentes de prontidão ficam energizadas.
    if (energia > 0.02) tracarComBrilho(grupos.livre, { cor: cores.acento, alfa: 0.5 * energia, largura: 1.2, blur: 6, alfaHalo: 0.2 * energia });
    pincel.setLineDash([6, 8]);
    pincel.lineDashOffset = reduzido ? 0 : -agoraMs * 0.045;
    tracarComBrilho(grupos.trabalhando, { cor: cores.acento, alfa: 0.95, largura: 1.7, blur: 12, alfaHalo: 0.42 });
    pincel.setLineDash([]);
    tracarComBrilho(grupos.entregue, { cor: cores.brilho, alfa: 1, largura: 2.1, blur: 16, alfaHalo: 0.48 });
  }

  // Partículas que correm do núcleo até cada agente; aceleram e clareiam com a voz do Frank.
  function desenharEnergia(quadro, dt, reduzido) {
    if (reduzido || energia < 0.02) return;
    const fala = Math.min(1, Math.sqrt(nivelSaida) * 1.3);
    faseDaEnergia = (faseDaEnergia + ((VELOCIDADE_DA_ENERGIA + ACELERACAO_NA_FALA * fala) * dt) / 1000) % 1000;
    const caudas = [new Path2D(), new Path2D()];
    const cabecas = [new Path2D(), new Path2D()];
    geometria.ancoras.forEach((ancora, indice) => {
      const trabalhando = quadro.status[indice] === 'trabalhando';
      const quantidade = trabalhando ? 5 : 2;
      const ritmo = trabalhando ? 1.8 : 1;
      const raio = trabalhando ? 2.8 : 2.2;
      const comprimento = 0.06 + 0.06 * fala;
      const { inicio, controle, fim } = caminhoDaLinha(ancora);
      for (let particula = 0; particula < quantidade; particula += 1) {
        const t = (faseDaEnergia * ritmo + particula / quantidade + indice * 0.137) % 1;
        // Nas pontas a partícula surge e some mais fraca: entra pelo núcleo e mergulha no cartão.
        const balde = t < 0.1 || t > 0.9 ? 0 : 1;
        const cauda = curva(Math.max(0, t - comprimento), inicio, controle, fim);
        const cabeca = curva(t, inicio, controle, fim);
        caudas[balde].moveTo(cauda.x, cauda.y);
        caudas[balde].lineTo(cabeca.x, cabeca.y);
        cabecas[balde].moveTo(cabeca.x + raio, cabeca.y);
        cabecas[balde].arc(cabeca.x, cabeca.y, raio, 0, Math.PI * 2);
      }
    });
    const forca = energia * (0.6 + 0.4 * fala);
    pincel.lineCap = 'round';
    for (const balde of [0, 1]) {
      const alfa = forca * (balde ? 1 : 0.4);
      tracarComBrilho(caudas[balde], { cor: cores.acento, alfa: 0.75 * alfa, largura: 1.8, blur: 8, alfaHalo: 0.3 * alfa, larguraHalo: 4 });
      preencherComBrilho(cabecas[balde], { cor: cores.calor, alfa, blur: 10 + 10 * fala });
    }
  }

  function desenharNucleo(quadro, agoraMs, reduzido) {
    const { cx, cy, R } = geometria;
    const ativo = quadro.sessao === 'ativa';
    const conectando = quadro.sessao === 'conectando';
    const saida = Math.min(1, Math.sqrt(nivelSaida) * 1.25);
    const entrada = quadro.mudo ? 0 : Math.min(1, Math.sqrt(nivelEntrada) * 1.15);
    const raioRetrato = R * 0.46;
    const respiracao = reduzido ? 0.5 : 0.5 + 0.5 * Math.sin(agoraMs / 900);

    // Halo atrás do núcleo: aceso com a sessão ativa e pulsando com a voz do Frank.
    const forcaDoHalo = (conectando ? 0.1 + 0.1 * respiracao : 0.04 + energia * (0.13 + 0.06 * respiracao) + 0.45 * saida) * (cores.claro ? 0.6 : 1);
    const alcanceDoHalo = R * (1.42 + 0.32 * saida);
    const halo = pincel.createRadialGradient(cx, cy, raioRetrato * 0.9, cx, cy, alcanceDoHalo);
    halo.addColorStop(0, paraRgba(cores.brilho, forcaDoHalo));
    halo.addColorStop(0.55, paraRgba(cores.acento, forcaDoHalo * 0.42));
    halo.addColorStop(1, paraRgba(cores.acento, 0));
    pincel.save();
    pincel.globalCompositeOperation = cores.claro ? 'source-over' : 'lighter';
    pincel.fillStyle = halo;
    pincel.beginPath();
    pincel.arc(cx, cy, alcanceDoHalo, 0, Math.PI * 2);
    pincel.fill();
    pincel.restore();

    pincel.save();
    pincel.translate(cx, cy);
    pincel.rotate(angulo);
    const curtas = new Path2D();
    const longas = new Path2D();
    for (let marca = 0; marca < MARCAS_DE_ESCALA; marca += 1) {
      const teta = (marca / MARCAS_DE_ESCALA) * Math.PI * 2;
      const longa = marca % 10 === 0;
      const destino = longa ? longas : curtas;
      const interno = R - (longa ? 11 : 5);
      destino.moveTo(Math.cos(teta) * interno, Math.sin(teta) * interno);
      destino.lineTo(Math.cos(teta) * R, Math.sin(teta) * R);
    }
    pincel.lineCap = 'butt';
    pincel.lineWidth = 1;
    pincel.strokeStyle = paraRgba(cores.traco, ativo ? 0.9 : 0.6);
    pincel.stroke(curtas);
    if (ativo) {
      tracarComBrilho(longas, { cor: cores.acento, alfa: 0.9, largura: 1.7, blur: 8, alfaHalo: 0.3 });
      const orbita = new Path2D();
      orbita.arc(0, 0, R + 4, 0, Math.PI * 2);
      pincel.strokeStyle = paraRgba(cores.acento, 0.16 + 0.2 * saida);
      pincel.lineWidth = 1;
      pincel.stroke(orbita);
      const arcos = new Path2D();
      arcos.arc(0, 0, R + 4, -0.2, 0.2);
      arcos.moveTo(Math.cos(Math.PI - 0.2) * (R + 4), Math.sin(Math.PI - 0.2) * (R + 4));
      arcos.arc(0, 0, R + 4, Math.PI - 0.2, Math.PI + 0.2);
      tracarComBrilho(arcos, { cor: cores.brilho, alfa: 1, largura: 2.4, blur: 16, alfaHalo: 0.55, larguraHalo: 6 });
    } else {
      pincel.lineWidth = 1.6;
      pincel.stroke(longas);
    }
    pincel.restore();

    pincel.save();
    pincel.translate(cx, cy);
    pincel.rotate(-angulo * 1.6);
    pincel.setLineDash([2, 7]);
    pincel.strokeStyle = ativo ? paraRgba(cores.acento, 0.55) : paraRgba(cores.traco, 0.8);
    pincel.lineWidth = 1;
    pincel.beginPath();
    pincel.arc(0, 0, R * 0.88, 0, Math.PI * 2);
    pincel.stroke();
    pincel.setLineDash([]);
    if (conectando) {
      const carga = new Path2D();
      carga.arc(0, 0, R * 0.88, 0, Math.PI * 0.45);
      pincel.lineCap = 'round';
      tracarComBrilho(carga, { cor: cores.brilho, alfa: 1, largura: 2.6, blur: 16, alfaHalo: 0.5 });
    }
    pincel.restore();

    const base = R * 0.57;
    const alcance = R * 0.84 - base;
    const barras = new Path2D();
    for (let barra = 0; barra < BARRAS_DE_VOZ; barra += 1) {
      const teta = (barra / BARRAS_DE_VOZ) * Math.PI * 2 - Math.PI / 2;
      const variacao = reduzido ? 1 : Math.abs(0.55 + 0.45 * Math.sin(agoraMs / 170 + barra * 1.7) * Math.sin(agoraMs / 310 + barra * 0.63));
      // Em silêncio com a sessão ativa, as barras respiram de leve; na fala, crescem com a amplitude.
      const repouso = ativo && !reduzido ? 2 + 1.4 * (0.5 + 0.5 * Math.sin(agoraMs / 520 + barra * 0.4)) : 1.5;
      const comprimento = repouso + alcance * Math.min(1, saida * 1.2) * (0.3 + 0.7 * variacao);
      barras.moveTo(cx + Math.cos(teta) * base, cy + Math.sin(teta) * base);
      barras.lineTo(cx + Math.cos(teta) * (base + comprimento), cy + Math.sin(teta) * (base + comprimento));
    }
    pincel.lineCap = 'round';
    if (ativo) {
      tracarComBrilho(barras, { cor: saida > 0.05 ? cores.brilho : cores.acento, alfa: 0.6 + 0.4 * saida, largura: 2.3, blur: 6 + 14 * saida, alfaHalo: 0.22 + 0.4 * saida, larguraHalo: 4.6 });
    } else {
      pincel.lineWidth = 2.2;
      pincel.strokeStyle = paraRgba(cores.traco, 0.7);
      pincel.stroke(barras);
    }

    const anel = new Path2D();
    anel.arc(cx, cy, R * 0.525, 0, Math.PI * 2);
    if (ativo) {
      tracarComBrilho(anel, { cor: cores.acento, alfa: 0.95, largura: 2, blur: 12 + 10 * saida, alfaHalo: 0.4 + 0.3 * saida });
    } else {
      pincel.lineWidth = 1;
      pincel.strokeStyle = paraRgba(cores.traco, 0.9);
      pincel.stroke(anel);
    }

    pincel.beginPath();
    pincel.arc(cx, cy, raioRetrato + 5, 0, Math.PI * 2);
    if (quadro.sessao === 'ativa' && quadro.mudo) {
      pincel.setLineDash([4, 5]);
      pincel.lineWidth = 2;
      pincel.strokeStyle = paraRgba(cores.alerta, 0.95);
    } else {
      pincel.lineWidth = 1.5 + entrada * 6;
      pincel.strokeStyle = paraRgba(cores.entrada, 0.2 + 0.78 * entrada);
    }
    pincel.stroke();
    pincel.setLineDash([]);

    const desde = agoraMs - destaque;
    if (desde >= 0 && desde < DURACAO_DESTAQUE_MS) {
      const fase = desde / DURACAO_DESTAQUE_MS;
      const onda = new Path2D();
      onda.arc(cx, cy, R * (reduzido ? 1.06 : 1 + fase * 0.24), 0, Math.PI * 2);
      tracarComBrilho(onda, { cor: cores.brilho, alfa: 0.95 * (1 - fase), largura: 3, blur: 20, alfaHalo: 0.5 * (1 - fase) });
    }
  }

  function desenharPulsos(agoraMs, reduzido) {
    pulsos = pulsos.filter((pulso) => agoraMs - pulso.inicio < pulso.duracao + DURACAO_DO_IMPACTO_MS);
    for (const pulso of pulsos) {
      if (agoraMs < pulso.inicio) continue;
      const ancora = geometria.ancoras[pulso.indice];
      if (!ancora) continue;
      const { inicio, controle, fim } = caminhoDaLinha(ancora);
      const decorrido = agoraMs - pulso.inicio;
      const progresso = Math.min(1, decorrido / pulso.duracao);

      if (reduzido) {
        const linha = new Path2D();
        linha.moveTo(inicio.x, inicio.y);
        linha.quadraticCurveTo(controle.x, controle.y, fim.x, fim.y);
        tracarComBrilho(linha, { cor: cores.acento, alfa: 1 - progresso, largura: 3, blur: 10 });
        continue;
      }

      const t = suave(progresso);
      const posicao = (valor) => curva(pulso.sentido === 'saida' ? valor : 1 - valor, inicio, controle, fim);
      const rastroFraco = new Path2D();
      const rastroForte = new Path2D();
      for (let passo = 0; passo <= 12; passo += 1) {
        const ponto = posicao(Math.max(0, t - 0.18 + (passo / 12) * 0.18));
        if (passo === 0) rastroFraco.moveTo(ponto.x, ponto.y);
        else if (passo <= 6) rastroFraco.lineTo(ponto.x, ponto.y);
        if (passo === 6) rastroForte.moveTo(ponto.x, ponto.y);
        else if (passo > 6) rastroForte.lineTo(ponto.x, ponto.y);
      }
      pincel.lineCap = 'round';
      tracarComBrilho(rastroFraco, { cor: cores.acento, alfa: 0.55, largura: 2, blur: 12, alfaHalo: 0.25, larguraHalo: 6 });
      tracarComBrilho(rastroForte, { cor: cores.brilho, alfa: 1, largura: 2.8, blur: 18, alfaHalo: 0.5, larguraHalo: 8 });
      const cabeca = posicao(t);
      const ponto = new Path2D();
      ponto.arc(cabeca.x, cabeca.y, 5, 0, Math.PI * 2);
      preencherComBrilho(ponto, { cor: cores.calor, alfa: 1, blur: 22 });

      // Ao chegar, um anel curto marca o impacto na ponta da linha.
      if (decorrido > pulso.duracao) {
        const fase = (decorrido - pulso.duracao) / DURACAO_DO_IMPACTO_MS;
        const alvo = pulso.sentido === 'saida' ? fim : inicio;
        const impacto = new Path2D();
        impacto.arc(alvo.x, alvo.y, 6 + 16 * fase, 0, Math.PI * 2);
        tracarComBrilho(impacto, { cor: cores.brilho, alfa: 1 - fase, largura: 2, blur: 14 });
      }
    }
  }

  function desenhar(agoraMs) {
    quadroAnimacao = requestAnimationFrame(desenhar);
    if (!geometria) return;
    const dt = Math.min(64, agoraMs - ultimoQuadro);
    ultimoQuadro = agoraMs;
    const reduzido = movimentoReduzido.matches;
    const quadro = obterQuadro();
    const niveis = obterNiveis();
    nivelSaida = suavizar(nivelSaida, niveis.saida, dt);
    nivelEntrada = suavizar(nivelEntrada, niveis.entrada, dt);
    energia += ((quadro.sessao === 'ativa' ? 1 : 0) - energia) * (1 - Math.exp(-dt / 260));
    if (!reduzido) {
      const velocidade = quadro.sessao === 'conectando' ? 1.6 : quadro.sessao === 'ativa' ? 0.09 + 0.2 * Math.sqrt(nivelSaida) : 0.04;
      angulo += (velocidade * dt) / 1000;
    }
    animarReserva(agoraMs);
    pincel.clearRect(0, 0, geometria.largura, geometria.altura);
    if (geometria.emArco) {
      desenharLinhas(quadro, agoraMs, reduzido);
      desenharEnergia(quadro, dt, reduzido);
      desenharPulsos(agoraMs, reduzido);
    }
    desenharNucleo(quadro, agoraMs, reduzido);
  }

  function cancelarDespertar() {
    for (const id of despertares) clearTimeout(id);
    despertares.clear();
  }

  const observador = new ResizeObserver(agendarLayout);
  observador.observe(palco);
  for (const elemento of cartoes()) observador.observe(elemento);
  if (estadoDoFrank) observador.observe(estadoDoFrank);
  relayout();
  quadroAnimacao = requestAnimationFrame(desenhar);

  return {
    relayout,
    pulsar(indice, sentido) {
      pulsos.push({ indice, sentido, inicio: performance.now(), duracao: DURACAO_PULSO_MS });
    },
    // O Frank acorda o time: energia do núcleo para cada agente; o cartão acende quando ela chega.
    acordar() {
      cancelarDespertar();
      const agora = performance.now();
      destaque = agora;
      cartoes().forEach((_, indice) => {
        const atraso = ATRASO_DO_DESPERTAR_MS + indice * INTERVALO_DO_DESPERTAR_MS;
        pulsos.push({ indice, sentido: 'saida', inicio: agora + atraso, duracao: DURACAO_DO_PULSO_DE_DESPERTAR_MS });
        const id = setTimeout(() => {
          despertares.delete(id);
          aoAcender?.(indice);
        }, atraso + DURACAO_DO_PULSO_DE_DESPERTAR_MS);
        despertares.add(id);
      });
    },
    adormecer() {
      cancelarDespertar();
      pulsos = pulsos.filter((pulso) => pulso.duracao !== DURACAO_DO_PULSO_DE_DESPERTAR_MS);
      aoApagar?.();
    },
    destacarNucleo() {
      destaque = performance.now();
    },
    // Abre ou fecha a faixa da aba de cenas; o núcleo e o arco deslizam num movimento só.
    reservarLateral(ligada, { instantaneo = false } = {}) {
      reserva.ligada = ligada;
      const alvo = ligada ? larguraDaAba(area.clientWidth) : 0;
      if (instantaneo || movimentoReduzido.matches) {
        Object.assign(reserva, { atual: alvo, de: alvo, alvo });
        relayout();
        return;
      }
      Object.assign(reserva, { de: reserva.atual, alvo, inicio: performance.now() });
    },
    atualizarTema() {
      cores = lerCores();
    },
    destruir() {
      cancelarDespertar();
      observador.disconnect();
      cancelAnimationFrame(quadroAnimacao);
    },
  };
}
