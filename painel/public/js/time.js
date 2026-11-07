// O time do Frank e a saudação ao acordar. O estado do time vem dos eventos do Hermes (painel-logica.js).
export const AGENTES = Object.freeze([
  { id: 'ulisses', nome: 'Ulisses', funcao: 'Estrategista das campanhas' },
  { id: 'isabela', nome: 'Isabela', funcao: 'Analista de resultados' },
  { id: 'renata', nome: 'Renata', funcao: 'Copywriter, escreve com a voz da marca' },
  { id: 'marina', nome: 'Marina', funcao: 'Webdesigner, monta e publica páginas aprovadas' },
  { id: 'lara', nome: 'Lara', funcao: 'Posts, carrosséis, roteiro e corte de Reels' },
  { id: 'breno', nome: 'Breno', funcao: 'Gestor de tráfego, anúncios com materiais aprovados' },
  { id: 'vitor', nome: 'Vitor', funcao: 'SDR no WhatsApp e no Direct, qualifica interessados' },
]);

const NOMES = new Map(AGENTES.map((agente) => [agente.id, agente.nome]));

export function nomeDoAgente(id) {
  return NOMES.get(id) ?? id;
}

function listarNomes(nomes) {
  if (nomes.length <= 1) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}`;
}

const MASCULINOS = new Set(['ulisses', 'breno', 'vitor']);
const comArtigo = (id) => `${MASCULINOS.has(id) ? 'o' : 'a'} ${nomeDoAgente(id)}`;
const comMaiuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

// Saudação do Frank ao acordar: muda com a hora, o dia da semana e o que o time está fazendo, no tom de parceiro
// de trabalho. Sem nada acontecendo, ela não lista o time: só cumprimenta e pergunta.
export function periodoDoDia(hora) {
  if (hora < 5) return 'madrugada';
  if (hora < 12) return 'manha';
  if (hora < 18) return 'tarde';
  return 'noite';
}

const CUMPRIMENTOS = { madrugada: 'boa noite', manha: 'bom dia', tarde: 'boa tarde', noite: 'boa noite' };

// Sem nome (nem nas configurações nem no FRANK_NOME_DO_DONO do servidor), a abertura sai sem o vocativo.
const vocativo = (nome) => (nome ? `, ${nome}` : '');
const ABERTURAS = [
  ({ nome, cumprimento }) => `E aí${vocativo(nome)}, ${cumprimento}!`,
  ({ nome, cumprimento }) => `Opa${vocativo(nome)}, ${cumprimento}, tudo beleza?`,
  ({ nome, cumprimento }) => `Fala${vocativo(nome)}, ${cumprimento}!`,
  ({ nome, cumprimento }) => `${comMaiuscula(cumprimento)}${vocativo(nome)}! Tudo certo por aí?`,
  ({ nome, cumprimento }) => `Salve${vocativo(nome)}, ${cumprimento}!`,
  ({ nome, cumprimento }) => `${comMaiuscula(cumprimento)}${vocativo(nome)}! Bom te ouvir.`,
];

const FECHAMENTOS = [
  'O que manda?',
  'Tá precisando de algo por aí?',
  'Qual é a boa de hoje?',
  'O que a gente ataca agora?',
  'Manda que eu resolvo.',
  'Tô por aqui, é só falar.',
];

const FECHAMENTOS_DO_PERIODO = {
  madrugada: ['Virando a noite, hein? Tô junto. O que manda?', 'Essa hora e você aí firme. Bora?'],
  manha: ['Bora começar o dia com tudo?', 'Café tomado? Então bora.'],
  tarde: ['Como tá sendo o dia? O que a gente resolve agora?', 'Bora fechar a tarde com coisa boa?'],
  noite: ['Vamos começar o trabalho? Tô ligado que essa é a hora que você mais dá o gás.', 'Ainda na ativa, hein? O que a gente resolve agora?'],
};

// Chave: Date.getDay() (0 é domingo).
const FECHAMENTOS_DO_DIA = {
  0: ['Nem no domingo você para, né? Tô aqui. Bora?'],
  1: ['Semana nova. Bora começar com tudo?'],
  5: ['Sextou! O que falta pra fechar a semana?'],
  6: ['Sábado e você na ativa, hein? Respeito. O que manda?'],
};

const FECHAMENTOS_COM_ENTREGA = ['Quer dar uma olhada?', 'Bora ver?', 'Dá uma olhada quando puder.'];

function contextoDoTime(estado) {
  const trabalhando = (estado?.agentes ?? []).filter((agente) => agente.status === 'trabalhando').map((agente) => agente.id);
  const pendentes = estado?.pendentes?.length ?? 0;
  const partes = [];
  if (trabalhando.length > 0) {
    const nomes = listarNomes(trabalhando.map(comArtigo));
    partes.push(`${comMaiuscula(nomes)} ${trabalhando.length === 1 ? 'tá' : 'tão'} trabalhando agora.`);
  }
  if (pendentes === 1) partes.push('Tem uma entrega esperando o seu ok.');
  else if (pendentes > 1) partes.push(`Tem ${pendentes} entregas esperando o seu ok.`);
  return partes.join(' ');
}

function escolher(lista, sortear) {
  return lista[Math.min(lista.length - 1, Math.floor(sortear() * lista.length))];
}

// anterior: a última saudação falada, para a próxima não sair igual. sortear: Math.random, ou um fixo nos testes.
export function saudacaoDoFrank({ nome = '', data = new Date(), estado, sortear = Math.random, anterior = '' }) {
  const periodo = periodoDoDia(data.getHours());
  const cumprimento = CUMPRIMENTOS[periodo];
  const contexto = contextoDoTime(estado);
  const especiais = [...FECHAMENTOS_DO_PERIODO[periodo], ...(FECHAMENTOS_DO_DIA[data.getDay()] ?? [])];
  let frase = '';
  for (let tentativa = 0; tentativa < 6; tentativa += 1) {
    const abertura = escolher(ABERTURAS, sortear)({ nome, cumprimento });
    let fechamento;
    if (estado?.pendentes?.length) fechamento = escolher(FECHAMENTOS_COM_ENTREGA, sortear);
    else fechamento = sortear() < 0.5 ? escolher(especiais, sortear) : escolher(FECHAMENTOS, sortear);
    frase = [abertura, contexto, fechamento].filter(Boolean).join(' ');
    if (frase !== anterior) break;
  }
  return frase;
}
