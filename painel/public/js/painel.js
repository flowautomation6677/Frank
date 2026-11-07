import { AGENTES } from './time.js';
import { formatarQuando, formatarSegundos, nomeDe, semOutraEscrita, textoSemMarcacao, trechosComDestaque } from './painel-logica.js';
import { numerosEmAlgarismos } from './numeros-na-legenda.js';

const FORMATO_HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const FORMATO_HORA_SEGUNDOS = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const FORMATO_DATA = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });
const LIMITE_LEGENDA = 240;
const LIMITE_REGISTRO = 80;
const PAUSA_ENTRE_TURNOS_MS = 2500;
const DURACAO_DO_ACENDER_MS = 950;
const FUNCOES = new Map(AGENTES.map((agente) => [agente.id, agente.funcao]));
const FUNCAO_DO_FRANK = 'Agente principal, toca o time';

function criar(tag, classe, texto) {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}

function retrato(id, tamanho) {
  const imagem = criar('img');
  imagem.src = `img/ag-${id}.webp`;
  imagem.alt = '';
  imagem.width = tamanho;
  imagem.height = tamanho;
  return imagem;
}

export function formatarCusto(dolares) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: dolares > 0 && dolares < 1 ? 3 : 2,
  }).format(dolares);
}

// O ângulo de cada ponteiro só cresce: na virada do minuto o ponteiro segue em frente, sem dar a volta para trás.
export function avancarPonteiro(anterior, alvo) {
  if (anterior === null) return alvo;
  return anterior + ((((alvo - anterior) % 360) + 360) % 360);
}

export function angulosDoRelogio(data) {
  const segundos = data.getSeconds();
  const minutos = data.getMinutes() + segundos / 60;
  return { hora: ((data.getHours() % 12) + minutos / 60) * 30, minuto: minutos * 6, segundo: segundos * 6 };
}

// ponteiros: { hora, minuto, segundo }, as linhas do reloginho; mostrador: o svg, que só anima depois da primeira marcação.
export function iniciarRelogio({ hora, segundos, data, ponteiros, mostrador }) {
  const angulos = { hora: null, minuto: null, segundo: null };
  function marcar() {
    const agora = new Date();
    hora.textContent = FORMATO_HORA.format(agora);
    hora.dateTime = agora.toISOString();
    segundos.textContent = `:${String(agora.getSeconds()).padStart(2, '0')}`;
    data.textContent = FORMATO_DATA.format(agora);
    if (!ponteiros) return;
    const alvos = angulosDoRelogio(agora);
    for (const [nome, ponteiro] of Object.entries(ponteiros)) {
      angulos[nome] = avancarPonteiro(angulos[nome], alvos[nome]);
      ponteiro.style.transform = `rotate(${angulos[nome]}deg)`;
    }
  }
  marcar();
  if (mostrador) requestAnimationFrame(() => mostrador.setAttribute('data-animado', 'sim'));
  setInterval(marcar, 1000);
}

export function montarCartoes(lista) {
  const ultimos = new Map();
  const elementos = AGENTES.map((agente) => {
    const item = criar('li', 'cartao');
    item.dataset.agente = agente.id;
    item.dataset.status = 'livre';

    const moldura = criar('div', 'cartao-retrato');
    moldura.append(retrato(agente.id, 44));
    const texto = criar('div', 'cartao-texto');
    const cabeca = criar('div', 'cartao-cabeca');
    cabeca.append(criar('p', 'cartao-nome', agente.nome), criar('span', 'cartao-status', 'livre'));
    texto.append(cabeca, criar('p', 'cartao-funcao', agente.funcao));
    const tarefa = criar('p', 'cartao-tarefa', 'Sem tarefa agora.');
    item.append(moldura, texto, tarefa);
    item.addEventListener('animationend', () => item.classList.remove('chegou'));
    lista.append(item);
    return item;
  });

  const deProntidao = new Set();
  let ultimoEstado = null;

  const rotuloLivre = (indice) => (deProntidao.has(AGENTES[indice].id) ? 'de prontidão' : 'livre');

  function atualizar(estado) {
    ultimoEstado = estado;
    estado.agentes.forEach((agente, indice) => {
      const item = elementos[indice];
      const chave = `${agente.status}|${agente.tarefa}|${agente.fila}|${agente.naFila ?? 0}|${deProntidao.has(agente.id)}`;
      if (ultimos.get(agente.id) === chave) return;
      const anterior = item.dataset.status;
      ultimos.set(agente.id, chave);

      item.dataset.status = agente.status;
      item.style.setProperty('--progresso', String(agente.progresso));
      const status = item.querySelector('.cartao-status');
      const tarefa = item.querySelector('.cartao-tarefa');
      if (agente.status === 'trabalhando') {
        // O Hermes não informa porcentagem: o anel e o fio do cartão correm enquanto o assistente trabalha.
        status.textContent = 'trabalhando';
        tarefa.textContent = agente.tarefa;
        if (agente.fila > 0) tarefa.append(' ', criar('span', 'cartao-fila', `+${agente.fila} em paralelo`));
      } else if (agente.status === 'travado') {
        status.textContent = 'travado';
        tarefa.textContent = `Travou: ${agente.tarefa}`;
      } else if (agente.status === 'entregue') {
        status.textContent = 'entregue';
        tarefa.textContent = `Entregou: ${agente.tarefa}`;
      } else if (agente.status === 'fila') {
        status.textContent = 'na fila';
        tarefa.textContent = `Próxima: ${agente.tarefa}`;
      } else {
        status.textContent = rotuloLivre(indice);
        tarefa.textContent = 'Sem tarefa agora.';
      }
      // Tarefas do quadro esperando a vez, além da que aparece no cartão.
      if (agente.naFila > 0 && agente.status !== 'livre') tarefa.append(' ', criar('span', 'cartao-fila', `+${agente.naFila} na fila`));
      if (anterior !== 'entregue' && agente.status === 'entregue') item.classList.add('chegou');
    });
  }

  function redesenhar() {
    if (ultimoEstado) atualizar(ultimoEstado);
  }

  // A energia do Frank chegou: o cartão acende e fica de prontidão até a sessão acabar.
  function acender(indice) {
    const item = elementos[indice];
    if (!item) return;
    deProntidao.add(AGENTES[indice].id);
    item.dataset.prontidao = 'sim';
    item.classList.remove('acendeu');
    void item.offsetWidth;
    item.classList.add('acendeu');
    clearTimeout(Number(item.dataset.acenderAte));
    item.dataset.acenderAte = String(setTimeout(() => item.classList.remove('acendeu'), DURACAO_DO_ACENDER_MS));
    redesenhar();
  }

  function apagarTodos() {
    deProntidao.clear();
    for (const item of elementos) item.dataset.prontidao = 'nao';
    redesenhar();
  }

  return { elementos, atualizar, acender, apagarTodos };
}

const chaveDe = (pendente) => pendente.chave ?? pendente.id;

// Texto da entrega com o negrito que os assistentes usam, montado em nós de texto: nada vira HTML.
function preencherComDestaque(elemento, texto) {
  elemento.replaceChildren(...trechosComDestaque(texto).map((parte) => (parte.forte ? criar('strong', '', parte.texto) : document.createTextNode(parte.texto))));
}

function horaDaEntrega(pendente) {
  const data = pendente.criadaEm ? new Date(pendente.criadaEm) : new Date();
  return Number.isNaN(data.getTime()) ? new Date() : data;
}

function criarCaixaDaEntrega(caixa, aoDecidir) {
  const campo = (nome) => caixa.querySelector(`[data-campo="${nome}"]`);
  const formulario = campo('ajuste');
  const entrada = formulario.querySelector('input');
  const botaoAjuste = campo('pedir-ajuste');
  let atual = null;
  let origem = null;

  function alternarAjuste(abrir) {
    formulario.hidden = !abrir;
    botaoAjuste.setAttribute('aria-expanded', String(abrir));
    if (abrir) entrada.focus();
  }

  campo('aprovar').addEventListener('click', () => {
    if (!atual) return;
    const chave = chaveDe(atual);
    caixa.close();
    aoDecidir(chave, 'aprovar', '');
  });
  campo('descartar').addEventListener('click', () => {
    if (!atual) return;
    const chave = chaveDe(atual);
    caixa.close();
    aoDecidir(chave, 'descartar', '');
  });
  botaoAjuste.addEventListener('click', () => alternarAjuste(formulario.hidden));
  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    if (!atual) return;
    const chave = chaveDe(atual);
    const observacao = entrada.value;
    caixa.close();
    aoDecidir(chave, 'ajustar', observacao);
  });
  campo('fechar').addEventListener('click', () => caixa.close());
  // Clique fora da caixa: o alvo é o próprio <dialog>, que cobre o fundo escurecido.
  caixa.addEventListener('click', (evento) => {
    if (evento.target === caixa) caixa.close();
  });
  caixa.addEventListener('close', () => {
    atual = null;
    if (origem?.isConnected) origem.focus();
    origem = null;
  });

  return {
    abrir(pendente, hora, elementoDeOrigem) {
      atual = pendente;
      origem = elementoDeOrigem;
      const imagem = campo('retrato');
      imagem.src = `img/ag-${pendente.agente ?? 'frank'}.webp`;
      campo('agente').textContent = nomeDe(pendente.agente);
      campo('funcao').textContent = pendente.agente ? FUNCOES.get(pendente.agente) ?? '' : FUNCAO_DO_FRANK;
      campo('hora').textContent = FORMATO_HORA.format(hora);
      campo('hora').dateTime = hora.toISOString();
      campo('duracao').textContent = typeof pendente.duracaoS === 'number' ? ` · levou ${formatarSegundos(pendente.duracaoS)}` : '';
      campo('tarefa').textContent = pendente.titulo;
      preencherComDestaque(campo('entrega'), pendente.entrega);
      campo('arquivo').textContent = pendente.arquivo ? `Arquivo no Hermes: ${pendente.arquivo}` : '';
      campo('arquivo').hidden = !pendente.arquivo;
      entrada.value = '';
      alternarAjuste(false);
      caixa.showModal();
      campo('aprovar').focus();
    },
    fecharSe(chave) {
      if (atual && chaveDe(atual) === chave && caixa.open) caixa.close();
    },
  };
}

export function criarBandeja({ secao, lista, contagem, titulo, caixa, aoDecidir }) {
  const itens = new Map();
  const caixaDaEntrega = caixa ? criarCaixaDaEntrega(caixa, aoDecidir) : null;

  function montarItem(pendente) {
    const chave = chaveDe(pendente);
    const nome = nomeDe(pendente.agente);
    const item = criar('li', 'pendencia nova');
    item.dataset.id = chave;
    item.addEventListener('animationend', () => item.classList.remove('nova'));

    const corpo = criar('div', 'pendencia-corpo');
    const meta = criar('p', 'pendencia-meta');
    const criadaEm = horaDaEntrega(pendente);
    const hora = criar('time', '', FORMATO_HORA.format(criadaEm));
    hora.dateTime = criadaEm.toISOString();
    meta.append(criar('b', '', nome), hora);
    if (typeof pendente.duracaoS === 'number') meta.append(criar('span', '', `levou ${formatarSegundos(pendente.duracaoS)}`));

    const acoes = criar('div', 'pendencia-acoes');
    const aprovar = criar('button', 'botao botao-primario botao-pequeno', 'Aprovar');
    aprovar.type = 'button';
    aprovar.addEventListener('click', () => aoDecidir(chave, 'aprovar', ''));

    const idFormulario = `ajuste-${chave}`;
    const ajustar = criar('button', 'botao botao-pequeno', 'Pedir ajuste');
    ajustar.type = 'button';
    ajustar.setAttribute('aria-expanded', 'false');
    ajustar.setAttribute('aria-controls', idFormulario);
    const descartar = criar('button', 'botao botao-pequeno botao-discreto', 'Descartar');
    descartar.type = 'button';
    descartar.setAttribute('aria-label', `Descartar a entrega de ${nome}: ${pendente.titulo}`);
    descartar.addEventListener('click', () => aoDecidir(chave, 'descartar', ''));
    acoes.append(aprovar, ajustar, descartar);

    const formulario = criar('form', 'pendencia-ajuste');
    formulario.id = idFormulario;
    formulario.hidden = true;
    const campo = criar('input');
    campo.type = 'text';
    campo.name = 'observacao';
    campo.maxLength = 200;
    campo.placeholder = 'O que mudar?';
    campo.required = true;
    campo.setAttribute('aria-label', `O que ajustar na entrega de ${nome}: ${pendente.titulo}`);
    const enviar = criar('button', 'botao botao-pequeno', 'Enviar ajuste');
    enviar.type = 'submit';
    formulario.append(campo, enviar);

    ajustar.addEventListener('click', () => {
      const abrir = formulario.hidden;
      formulario.hidden = !abrir;
      ajustar.setAttribute('aria-expanded', String(abrir));
      if (abrir) campo.focus();
    });
    formulario.addEventListener('submit', (evento) => {
      evento.preventDefault();
      aoDecidir(chave, 'ajustar', campo.value);
    });

    const cabecalho = criar('h3');
    let abrirCaixa = null;
    if (caixaDaEntrega) {
      abrirCaixa = criar('button', 'pendencia-abrir', pendente.titulo);
      abrirCaixa.type = 'button';
      abrirCaixa.setAttribute('aria-haspopup', 'dialog');
      abrirCaixa.addEventListener('click', () => caixaDaEntrega.abrir(pendente, criadaEm, abrirCaixa));
      cabecalho.append(abrirCaixa);
      // O item inteiro abre a caixa; os botões e o campo de ajuste continuam com a ação deles.
      item.addEventListener('click', (evento) => {
        if (evento.target.closest('button, input, form, a')) return;
        caixaDaEntrega.abrir(pendente, criadaEm, abrirCaixa);
      });
    } else {
      cabecalho.textContent = pendente.titulo;
    }

    corpo.append(meta, cabecalho, criar('p', 'pendencia-entrega', textoSemMarcacao(pendente.entrega)), acoes, formulario);
    item.append(retrato(pendente.agente ?? 'frank', 38), corpo);
    return item;
  }

  function atualizar(pendentes) {
    const chaves = new Set(pendentes.map(chaveDe));
    for (const [chave, item] of itens) {
      if (chaves.has(chave)) continue;
      caixaDaEntrega?.fecharSe(chave);
      const tinhaFoco = item.contains(document.activeElement);
      item.remove();
      itens.delete(chave);
      if (tinhaFoco) titulo.focus();
    }
    for (const pendente of pendentes) {
      const chave = chaveDe(pendente);
      if (itens.has(chave)) continue;
      const item = montarItem(pendente);
      itens.set(chave, item);
      lista.prepend(item);
    }
    contagem.textContent = String(pendentes.length);
    secao.dataset.tem = pendentes.length > 0 ? 'sim' : 'nao';
  }

  return { atualizar };
}

// Cartão "O Frank precisa da sua autorização". Não pega o foco ao abrir: o Espaço é o atalho do microfone,
// e um botão focado o engoliria, autorizando sem querer.
export function montarCartaoDeAutorizacao({ raiz, aoResponder }) {
  const campo = (nome) => raiz.querySelector(`[data-campo="${nome}"]`);
  const botoes = { sim: campo('sim'), nao: campo('nao') };
  const rotulos = { sim: botoes.sim.textContent, nao: botoes.nao.textContent };
  let runIdAtual = null;
  let requestIdAtual = null;
  let mostrado = '';

  for (const decisao of ['sim', 'nao']) {
    botoes[decisao].addEventListener('click', () => {
      if (runIdAtual !== null) aoResponder(runIdAtual, decisao, requestIdAtual);
    });
  }
  raiz.addEventListener('animationend', () => raiz.classList.remove('nova'));

  function destacar() {
    raiz.classList.remove('nova');
    void raiz.offsetWidth;
    raiz.classList.add('nova');
  }

  function mostrar(estado) {
    raiz.hidden = estado.fase === 'fechado';
    raiz.dataset.fase = estado.fase;
    campo('pedido').hidden = estado.fase !== 'aberto';
    campo('aviso').hidden = estado.fase !== 'aviso';
    campo('aviso').textContent = estado.fase === 'aviso' ? estado.aviso : '';
    if (estado.fase !== 'aberto') {
      runIdAtual = null;
      raiz.removeAttribute('aria-busy');
      mostrado = '';
      return;
    }
    const { pedido, fila } = estado;
    runIdAtual = pedido.runId;
    requestIdAtual = pedido.requestId ?? null;
    campo('descricao').textContent = pedido.descricao || 'O Hermes segurou um comando que pode apagar ou mudar algo.';
    campo('comando').textContent = pedido.comando;
    campo('caixa-comando').hidden = !pedido.comando;
    campo('erro').textContent = pedido.erro;
    campo('erro').hidden = !pedido.erro;
    campo('fila').textContent = fila === 1 ? 'Mais 1 pedido esperando depois deste.' : `Mais ${fila} pedidos esperando depois deste.`;
    campo('fila').hidden = !(fila > 0);
    for (const decisao of ['sim', 'nao']) {
      botoes[decisao].disabled = Boolean(pedido.enviando);
      botoes[decisao].textContent = pedido.enviando === decisao ? 'Enviando…' : rotulos[decisao];
    }
    if (pedido.enviando) raiz.setAttribute('aria-busy', 'true');
    else raiz.removeAttribute('aria-busy');
    // Pedido novo (outro run ou outro comando) entra com o movimento das entregas da bandeja.
    const chave = `${pedido.runId}\n${pedido.requestId ?? ""}\n${pedido.comando}\n${pedido.descricao}`;
    if (chave !== mostrado) destacar();
    mostrado = chave;
  }

  return { mostrar, destacar };
}

function popoverAberto(elemento) {
  try {
    return elemento.matches(':popover-open');
  } catch {
    return false;
  }
}

// Demandas num popover preso ao botão da barra: começar uma nova ou retomar uma anterior.
export function criarSeletorDeDemandas({ botao, titulo, painel, lista, nota, nova, carregar, aoEscolher, aoNova }) {
  let ativa = null;
  let pedido = 0;

  function mostrarAtiva() {
    titulo.textContent = ativa?.titulo || 'Nova demanda';
    botao.title = ativa?.id
      ? `Demanda ativa: ${ativa.titulo || 'Nova demanda'}. Clique para trocar ou começar outra.`
      : 'O próximo pedido ao Frank abre uma demanda nova. Clique para retomar uma anterior.';
  }

  function avisar(texto, tipo) {
    nota.textContent = texto;
    nota.hidden = !texto;
    if (tipo) nota.dataset.tipo = tipo;
    else delete nota.dataset.tipo;
  }

  function montarItem(demanda) {
    const eAtiva = demanda.id === ativa?.id;
    const item = criar('li');
    const escolher = criar('button', 'demanda-item');
    escolher.type = 'button';
    if (eAtiva) escolher.setAttribute('aria-current', 'true');
    const cabeca = criar('span', 'demanda-item-cabeca');
    cabeca.append(criar('span', 'demanda-item-titulo', demanda.titulo || 'Nova demanda'));
    if (eAtiva) cabeca.append(criar('span', 'demanda-item-ativa', 'ativa'));
    const pendentes = Number(demanda.pendentes) || 0;
    const situacao = pendentes === 0 ? 'nada pendente' : pendentes === 1 ? '1 para aprovar' : `${pendentes} para aprovar`;
    const meta = criar('span', 'demanda-item-meta', [formatarQuando(demanda.atualizadaEm), situacao].filter(Boolean).join(' · '));
    if (pendentes > 0) meta.dataset.pendentes = 'sim';
    escolher.append(cabeca, meta);
    escolher.addEventListener('click', () => {
      painel.hidePopover();
      if (!eAtiva) aoEscolher(demanda);
    });
    item.append(escolher);
    return item;
  }

  async function preencher() {
    const meu = ++pedido;
    avisar('Carregando demandas…');
    let demandas;
    try {
      demandas = await carregar();
    } catch (erro) {
      if (meu !== pedido) return;
      lista.replaceChildren();
      avisar(erro.message, 'alerta');
      return;
    }
    if (meu !== pedido) return;
    // A ativa fica no topo; as outras seguem a ordem do servidor (mais recente primeiro).
    const ordenadas = [...demandas].sort((a, b) => Number(b.id === ativa?.id) - Number(a.id === ativa?.id));
    lista.replaceChildren(...ordenadas.map(montarItem));
    avisar(ordenadas.length ? '' : 'Nenhuma demanda ainda. O primeiro pedido ao Frank abre uma.');
  }

  function posicionar() {
    const caixa = botao.getBoundingClientRect();
    const largura = Math.min(380, innerWidth - 24);
    painel.style.top = `${Math.round(caixa.bottom + 8)}px`;
    painel.style.left = `${Math.round(Math.max(12, Math.min(caixa.left, innerWidth - largura - 12)))}px`;
  }

  painel.addEventListener('beforetoggle', (evento) => {
    if (evento.newState !== 'open') return;
    posicionar();
    preencher();
  });
  painel.addEventListener('toggle', (evento) => botao.setAttribute('aria-expanded', String(evento.newState === 'open')));
  nova.addEventListener('click', () => {
    painel.hidePopover();
    aoNova();
  });
  addEventListener('resize', () => {
    if (popoverAberto(painel)) posicionar();
  });

  return {
    definir(demanda) {
      ativa = demanda;
      mostrarAtiva();
    },
    abrir() {
      if (!popoverAberto(painel)) painel.showPopover();
    },
    fechar() {
      if (popoverAberto(painel)) painel.hidePopover();
    },
    aberto: () => popoverAberto(painel),
  };
}

export function criarRegistro(lista) {
  return {
    adicionar(texto, tipo = 'info') {
      const item = criar('li');
      item.dataset.tipo = tipo;
      const agora = new Date();
      const hora = criar('time', '', FORMATO_HORA_SEGUNDOS.format(agora));
      hora.dateTime = agora.toISOString();
      item.append(hora, criar('span', '', texto));
      lista.prepend(item);
      while (lista.children.length > LIMITE_REGISTRO) lista.lastElementChild.remove();
    },
  };
}

export function rolarLegenda(texto, ate = texto.scrollHeight) {
  const alvo = Math.max(0, Math.round(ate - texto.clientHeight));
  if (Math.abs(texto.scrollTop - alvo) > 1) texto.scrollTop = alvo;
  texto.dataset.rolou = alvo > 0 ? 'sim' : 'nao';
}

export function criarLegendas({ frank, usuario }) {
  const alvos = { frank, usuario };
  const caixa = frank.closest('.legendas');
  const textos = { frank: '', usuario: '' };
  const ultimoTrecho = { frank: 0, usuario: 0 };
  let ultimoFalante = null;

  function mostrar(quem) {
    const limpo = numerosEmAlgarismos(semOutraEscrita(textos[quem])).replace(/\s+/g, ' ').trim();
    alvos[quem].textContent = limpo.length > LIMITE_LEGENDA ? `…${limpo.slice(-LIMITE_LEGENDA)}` : limpo;
    alvos[quem].parentElement.dataset.vazia = limpo ? 'nao' : 'sim';
    rolarLegenda(alvos[quem]);
  }

  return {
    receber({ quem, texto, parcial }) {
      const alvo = quem === 'frank' ? 'frank' : 'usuario';
      const agora = Date.now();
      if (parcial) {
        const turnoNovo = (ultimoFalante !== alvo && agora - ultimoTrecho[alvo] > 600) || agora - ultimoTrecho[alvo] > PAUSA_ENTRE_TURNOS_MS;
        textos[alvo] = turnoNovo ? texto : textos[alvo] + texto;
      } else {
        textos[alvo] = texto;
      }
      ultimoTrecho[alvo] = agora;
      ultimoFalante = alvo;
      if (caixa) caixa.dataset.ativo = alvo;
      mostrar(alvo);
    },
    limpar() {
      textos.frank = '';
      textos.usuario = '';
      mostrar('frank');
      mostrar('usuario');
    },
  };
}
