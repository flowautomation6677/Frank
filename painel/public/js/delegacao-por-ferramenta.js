// Delegação do motor que entrega ao Hermes por ferramenta (Gemini Live), com o contrato da delegação
// nativa do GPT Live (motor-gpt-live.js): cada chamada da ferramenta vira um turno no Hermes, e só a delegação mais
// recente fala o resultado. A que não abre turno (fala vazia, resposta a uma autorização ou turno recusado pelo servidor)
// devolve a vez a quem esperava, para a fala final do turno pausado não ser descartada.
import { criarNarrador } from './narrador.js';
import { textoDaRespostaPorVoz, textoDeAutorizacaoPendente, textoDoPensamento } from './painel-logica.js';

export const FERRAMENTA_DO_TIME = 'falar_com_o_time';
export const FERRAMENTA_DO_ANDAMENTO = 'andamento_do_time';
// Os mesmos rótulos de functions/_lib/frank.js, que as instruções do modelo explicam; o teste confere os dois lados.
export const ROTULOS_DO_PAINEL = Object.freeze({
  resultado: '[RESPOSTA DO FRANK]',
  aviso: '[AVISO DO PAINEL]',
  autorizacao: '[AUTORIZAÇÃO]',
  instrucao: '[INSTRUÇÃO DO PAINEL]',
  trabalhando: '[FRANK TRABALHANDO]',
});

export const FALA_DE_ERRO = 'Travei aqui do meu lado e não consegui falar com o time. Repete o pedido pra mim?';
export const FALA_SEM_PEDIDO = 'Não peguei direito o que você falou. Repete pra mim?';
export const SEM_FALA_DO_TIME = 'O time terminou, mas não mandou nada para falar agora.';
export const ANDAMENTO_INICIAL = 'O Frank recebeu o pedido e está distribuindo para o time.';
export const SEM_ANDAMENTO = 'Ninguém do time está trabalhando num pedido agora.';

const limpar = (texto) => String(texto ?? '').replace(/\s+/g, ' ').trim();

// responder(id, texto, { falar }): o motor entrega ao modelo o texto da delegação id. Com falar falso, o modelo fica
// sabendo e não fala (delegação vencida ou turno sem fala). informar(texto): andamento do time, sem pedir fala.
// aberta(): a sessão está de pé e não pediu para fechar; com ela fechada nada é entregue, e o painel acorda a voz
// de novo para dar o resultado. narrar(texto): a voz fala o andamento em primeira pessoa (narrador.js), com falando()
// e usuarioFalouEm() da sessão; sem narrar, nada é narrado.
export function criarDelegacao({ executarTurno, aoRespostaDescartada, responder, informar = () => {}, aberta, narrar, falando = () => false, usuarioFalouEm = () => 0, relogio }) {
  let daVez = null;
  let pontes = 0;
  let andamento = '';
  const emAndamento = new Set();

  // pedido: o que a ferramenta trouxe. reserva: a última fala do usuário na transcrição, se a ferramenta veio vazia.
  async function delegar(id, pedido, reserva = '') {
    const anterior = daVez;
    daVez = id;
    const valeAinda = () => aberta() && daVez === id;
    const devolverAVez = () => {
      if (daVez === id) daVez = anterior && emAndamento.has(anterior) ? anterior : null;
    };
    const texto = limpar(pedido) || limpar(reserva);
    if (!texto) {
      responder(id, FALA_SEM_PEDIDO, { falar: true });
      devolverAVez();
      return;
    }
    emAndamento.add(id);
    andamento = ANDAMENTO_INICIAL;
    const narrador = narrar
      ? criarNarrador({ narrar: (fala) => valeAinda() && narrar(fala), falando, usuarioFalouEm, relogio, ponte: pontes++ })
      : null;
    try {
      const resultado = await executarTurno({
        texto,
        delegacaoId: id,
        aoEvento: (evento) => {
          narrador?.evento(evento);
          if (evento.tipo !== 'agente_inicio' || daVez !== id) return;
          andamento = textoDoPensamento(evento.agente, evento.tarefa);
          if (aberta()) informar(andamento);
        },
      });
      if (!aberta()) return;
      // A fala era o sim ou o não da autorização: o servidor não abriu run, e o turno que pediu segue.
      if (resultado.aprovacao) {
        responder(id, textoDaRespostaPorVoz(resultado.aprovacao), { falar: valeAinda() });
        devolverAVez();
        return;
      }
      if (daVez !== id) {
        responder(id, resultado.fim?.fala || SEM_FALA_DO_TIME, { falar: false });
        aoRespostaDescartada?.(resultado);
        return;
      }
      if (resultado.fim?.fala) responder(id, resultado.fim.fala, { falar: true });
      else responder(id, SEM_FALA_DO_TIME, { falar: false });
    } catch (erro) {
      if (!aberta()) return;
      // Com autorização de pé, fala que não é sim nem não volta com 409: o Frank repete o pedido.
      if (erro?.aprovacaoPendente) {
        responder(id, textoDeAutorizacaoPendente(erro.aprovacaoPendente), { falar: valeAinda() });
        devolverAVez();
        return;
      }
      // O painel já registrou a falha do turno; aqui só o Frank avisa, se a delegação ainda for a da vez.
      responder(id, FALA_DE_ERRO, { falar: valeAinda() });
      // O servidor nem aceitou o turno (como o sim que chega depois do prazo): não toma a vez.
      if (!erro?.aceito) devolverAVez();
    } finally {
      narrador?.parar();
      emAndamento.delete(id);
      if (daVez === id) daVez = null;
      if (emAndamento.size === 0) andamento = '';
    }
  }

  return {
    delegar,
    andamento: () => (emAndamento.size > 0 ? andamento || ANDAMENTO_INICIAL : SEM_ANDAMENTO),
    get daVez() {
      return daVez;
    },
  };
}
