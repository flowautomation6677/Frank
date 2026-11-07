// O Frank nunca fica calado enquanto trabalha, com qualquer motor de voz e qualquer cérebro:
// ponte garantida logo depois do pedido, o aviso que o próprio Frank escreve no meio do turno (evento andamento) e,
// com a voz calada por muito tempo, um andamento falado com o que ele está fazendo.
import { textoDaAtividade } from './painel-logica.js';

// Sem a voz falar nada até aqui depois do pedido, a ponte sai pelo painel.
export const PRAZO_DA_PONTE_MS = 2500;
// Silêncio até cada andamento falado; depois do último, ele se repete no mesmo intervalo.
export const SILENCIOS_DO_ANDAMENTO_MS = Object.freeze([15_000, 25_000, 40_000, 60_000, 90_000]);
// Fala do usuário há menos que isso: o Frank espera a vez.
const VEZ_DO_USUARIO_MS = 3000;
// Depois de mandar a voz falar, o tempo que ela leva para começar.
const PARTIDA_DA_VOZ_MS = 2000;
const INTERVALO_MS = 500;
// Aviso do Frank maior que isso é resposta adiantada, não andamento: fica para a fala final.
export const LIMITE_DO_AVISO = 260;

export const PONTES = Object.freeze([
  'Deixa eu ver isso aqui, já te falo.',
  'Peraí, vou olhar isso agora e já volto.',
  'Só um minutinho, vou ver isso aqui.',
]);
const FECHOS = Object.freeze(['já te falo.', 'me dá mais um minutinho.', 'já volto com a resposta.', 'sigo aqui, já te conto.']);

const RELOGIO = Object.freeze({
  agora: () => Date.now(),
  // No Node (testes), o unref não prende o processo num turno que nunca termina.
  setInterval: (funcao, ms) => {
    const id = setInterval(funcao, ms);
    id?.unref?.();
    return id;
  },
  clearInterval: (id) => clearInterval(id),
});

const semReticencias = (texto) => String(texto ?? '').replace(/…$/u, '').trim();

// "Pesquisando na web…" vira "tô pesquisando na web"; "Frank revisando…" vira "tô revisando"; o andamento de um
// assistente ("A Renata tá escrevendo: …") fica como está.
function verboDaAtividade(atividade) {
  const limpa = semReticencias(atividade);
  if (!limpa) return '';
  if (/^Frank /u.test(limpa)) return `tô ${limpa.slice('Frank '.length)}`;
  if (/^O Frank tá /u.test(limpa)) return `tô ${limpa.slice('O Frank tá '.length)}`;
  if (/^\p{Lu}\p{Ll}+ndo\b/u.test(limpa)) return `tô ${limpa[0].toLowerCase()}${limpa.slice(1)}`;
  return '';
}

// vez: quantos andamentos já saíram neste turno. compondo: as ferramentas acabaram e o Frank está escrevendo a resposta.
export function falaDoAndamento({ atividade = '', compondo = false, vez = 0 } = {}) {
  const ainda = vez > 0;
  if (compondo) return ainda ? 'Tô fechando a resposta aqui, já te falo.' : 'Já tenho o que precisava, tô montando a resposta pra você.';
  const verbo = verboDaAtividade(atividade);
  const fecho = FECHOS[vez % FECHOS.length];
  if (verbo) return `${ainda ? 'Ainda ' : ''}${ainda ? verbo : verbo[0].toUpperCase() + verbo.slice(1)}, ${fecho}`;
  const assistente = semReticencias(atividade);
  if (assistente) return `${assistente}. Assim que ficar pronto, te conto.`;
  return ainda ? `Ainda tô pensando aqui, ${fecho}` : 'Tô pensando aqui na melhor resposta, só mais um pouquinho.';
}

// Um narrador por turno pedido pela voz. narrar(texto) manda a voz falar o texto em primeira pessoa; falando() diz se
// a voz está falando agora; usuarioFalouEm() é a hora da última fala do usuário. parar() quando o turno acaba.
export function criarNarrador({ narrar, falando, usuarioFalouEm = () => 0, relogio = RELOGIO, ponte = 0 }) {
  const inicio = relogio.agora();
  let ultimaVoz = 0;
  let ultimoAviso = 0;
  let vozFalou = false;
  let ponteFeita = false;
  let aviso = '';
  let atividade = '';
  let compondo = false;
  let abertas = 0;
  let andamentos = 0;
  let parado = false;
  // Com um pedido de autorização de pé, o que falta é o sim ou o não do usuário: o andamento não sai.
  let esperandoAutorizacao = false;

  function dizer(texto, agora) {
    ultimoAviso = agora;
    narrar(texto);
  }

  function tique() {
    if (parado) return;
    const agora = relogio.agora();
    if (falando()) {
      ultimaVoz = agora;
      vozFalou = true;
      return;
    }
    if (agora - usuarioFalouEm() < VEZ_DO_USUARIO_MS) return;
    if (ultimoAviso && agora - ultimoAviso < PARTIDA_DA_VOZ_MS) return;
    if (aviso) {
      const texto = aviso;
      aviso = '';
      ponteFeita = true;
      dizer(texto, agora);
      return;
    }
    if (!vozFalou && !ponteFeita) {
      if (agora - inicio < PRAZO_DA_PONTE_MS) return;
      ponteFeita = true;
      dizer(PONTES[ponte % PONTES.length], agora);
      return;
    }
    if (esperandoAutorizacao) return;
    const silencio = agora - Math.max(inicio, ultimaVoz, ultimoAviso);
    if (silencio < SILENCIOS_DO_ANDAMENTO_MS[Math.min(andamentos, SILENCIOS_DO_ANDAMENTO_MS.length - 1)]) return;
    dizer(falaDoAndamento({ atividade, compondo, vez: andamentos }), agora);
    andamentos += 1;
  }

  const sonda = relogio.setInterval(tique, INTERVALO_MS);

  return {
    evento(evento) {
      if (parado || !evento) return;
      if (evento.tipo === 'andamento') {
        if (evento.texto && evento.texto.length <= LIMITE_DO_AVISO) aviso = evento.texto;
        return;
      }
      if (evento.tipo === 'aprovacao') {
        esperandoAutorizacao = true;
        return;
      }
      if (evento.tipo === 'aprovacao_fim') {
        esperandoAutorizacao = false;
        ultimoAviso = relogio.agora();
        return;
      }
      if (evento.tipo === 'ferramenta' && evento.fase === 'fim') {
        abertas = Math.max(0, abertas - 1);
        if (abertas === 0) compondo = true;
        return;
      }
      const texto = textoDaAtividade(evento);
      if (evento.tipo === 'ferramenta') abertas += 1;
      if (!texto) return;
      atividade = texto;
      compondo = false;
    },
    parar() {
      if (parado) return;
      parado = true;
      relogio.clearInterval(sonda);
    },
  };
}
