// Autorização de comando destrutivo (eventos aprovacao e aprovacao_fim, rota /aprovacao e autorização por voz).
// Funções puras sobre a demanda; quem grava é a ponte, pela fila da demanda.
//
// Cada turno guarda os pedidos em runs[].aprovacoes: { requestId, runId, comando, descricao, pedidaEm, decisao,
// respondidaEm? }. runId é o run do Hermes que espera (o do turno ou o do empurrão). decisao fica null enquanto o
// Hermes espera; depois vira sim, nao ou expirou.

const RESPOSTAS_SIM = ['sim', 'pode', 'autorizo', 'confirmo', 'manda ver', 'pode apagar', 'pode rodar'];
const RESPOSTAS_NAO = ['não', 'nao', 'cancela', 'para', 'não pode', 'não autorizo'];

// Caixa, acento, pontuação e o vocativo "Frank", em qualquer posição, não contam: "NÃO!" vale "não" e
// "Pode, Frank" vale "pode".
const normalizar = (texto) =>
  texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((palavra) => palavra && palavra !== 'frank')
    .join(' ');

const RESPOSTAS = new Map([
  ...RESPOSTAS_SIM.map((resposta) => [normalizar(resposta), 'sim']),
  ...RESPOSTAS_NAO.map((resposta) => [normalizar(resposta), 'nao']),
]);

// Só vale o texto que é inteiro um sim ou um não da lista. null = qualquer outro texto.
export const decisaoPorVoz = (texto) => RESPOSTAS.get(normalizar(texto)) ?? null;

// O pedido mais recente sem decisão num turno que ainda roda: é o que o painel mostra.
export function pedidoPendente(demanda) {
  for (const run of demanda.runs.toReversed()) {
    if (run.status !== 'rodando') continue;
    const pedido = run.aprovacoes?.findLast((item) => item.decisao === null);
    if (pedido) return { run, pedido };
  }
  return null;
}

// Reconectar repete o backlog do Hermes: pedido com o mesmo requestId fica com o registro que já existe.
export function anotarPedido(run, { requestId, runId, comando, descricao }, agora = new Date()) {
  run.aprovacoes ??= [];
  const existente = requestId ? run.aprovacoes.find((item) => item.requestId === requestId) : undefined;
  if (existente) return existente;
  const pedido = { requestId, runId, comando, descricao, pedidaEm: agora.toISOString(), decisao: null };
  run.aprovacoes.push(pedido);
  return pedido;
}

// A primeira decisão vale: a rota, a voz e o relay anotam a mesma resposta. Sem requestId, a decisão vai para o
// pedido mais antigo daquele run do Hermes, a mesma ordem em que o Hermes resolve.
export function anotarDecisao(run, { requestId, runId }, decisao, agora = new Date()) {
  const pedidos = run.aprovacoes ?? [];
  const pedido = requestId
    ? pedidos.find((item) => item.requestId === requestId)
    : pedidos.find((item) => item.decisao === null && item.runId === runId);
  if (!pedido || pedido.decisao !== null) return;
  pedido.decisao = decisao;
  pedido.respondidaEm = agora.toISOString();
}
