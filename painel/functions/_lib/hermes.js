// Cliente do Hermes (perfil frank). Só Web APIs: o acesso a disco fica em demandas.js.
import { ErroHttp, omitirSegredos } from './http.js';
import { IDS_DO_TIME } from './frank.js';
import { descricaoEmPortugues } from './descricoes-do-hermes.js';
import { obterSegredo } from './cofre.js';

export const MOTIVO_SO_LOCAL = 'O Frank precisa do Hermes, que só roda no servidor local.';
// O comando time-do-frank voz regrava o .env do painel com a API do Frank (HERMES_API_URL e HERMES_API_KEY).
export const MOTIVO_SEM_HERMES = 'O painel não achou o Frank. No terminal da VPS, rode: time-do-frank voz';
export const MOTIVO_SEM_AUTORIZACAO = 'Não tem autorização pendente neste turno.';

const ESFORCO_NO_HERMES = { baixo: 'low', medio: 'medium', alto: 'high' };
export const ESFORCOS = Object.keys(ESFORCO_NO_HERMES);
const VALIDADE_DOS_MODELOS_MS = 60_000;
const LIMITE_DO_RESUMO = 160;
const PREFIXO_DO_AGENTE = /^\s*\[([^\]]+)\]\s*/;
const PREFIXO_DA_REVISAO = 'revisao';
const TIPOS_DE_ENTREGA = ['estrategia', 'metricas', 'copy', 'pagina', 'conteudo', 'trafego', 'vendas', 'revisao', 'outro'];
const ID_DA_SESSAO = /^[A-Za-z0-9_.:-]{1,100}$/;
const MENSAGENS_LIDAS_DA_SESSAO = 20;
const FIM_DO_TURNO = { 'run.failed': 'falhou', 'run.cancelled': 'foi cancelado', 'run.interrupted': 'foi interrompido' };
// O Hermes resolve os aliases (approve, allow) antes de emitir approval.responded.
const DECISAO_DO_HERMES = { once: 'sim', session: 'sim', always: 'sim', deny: 'nao' };
const SEM_AUTORIZACAO = { status: 409, mensagem: MOTIVO_SEM_AUTORIZACAO };
const RUN_ESQUECIDO = { status: 404, mensagem: 'O Hermes não conhece mais este turno.' };

// FRANK_PASTA_DE_DADOS só existe quando o server.mjs monta o env.
export function exigirHermes(env) {
  if (!env.FRANK_PASTA_DE_DADOS) throw new ErroHttp(503, MOTIVO_SO_LOCAL);
  const chave = obterSegredo('HERMES_API_KEY', env) || env.HERMES_API_KEY;
  if (!env.HERMES_API_URL || !chave) throw new ErroHttp(503, MOTIVO_SEM_HERMES);
  let origem;
  try {
    origem = new URL(env.HERMES_API_URL).origin;
  } catch (erro) {
    throw new ErroHttp(503, 'HERMES_API_URL no .env não é um endereço válido.', undefined, { cause: erro });
  }
  return { base: env.HERMES_API_URL.replace(/\/+$/, ''), origem, chave };
}

// recusas: status do Hermes → { status, mensagem } que a rota devolve no lugar do 502 genérico.
export async function chamarHermes(fetchFn, hermes, caminho, { metodo = 'GET', corpo, signal, acao, timeoutMs = 10_000, aceitar = 'application/json', recusas = {} }) {
  let resposta;
  try {
    resposta = await fetchFn(`${hermes.base}${caminho}`, {
      method: metodo,
      headers: {
        authorization: `Bearer ${hermes.chave}`,
        accept: aceitar,
        ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (erro) {
    if (erro?.name === 'TimeoutError') throw new ErroHttp(504, `O Hermes não respondeu em ${timeoutMs / 1000} s ao pedido para ${acao}.`, undefined, { cause: erro });
    const motivo = omitirSegredos(String(erro?.cause?.code ?? erro?.message ?? erro), [hermes.chave]);
    throw new ErroHttp(503, `O Hermes não está respondendo em ${hermes.origem}. Confira se o Hermes está rodando e tente de novo.`, motivo, { cause: erro });
  }
  if (!resposta.ok) {
    const recusa = Object.hasOwn(recusas, resposta.status) ? recusas[resposta.status] : null;
    if (recusa) {
      await resposta.body?.cancel().catch(() => {});
      throw new ErroHttp(recusa.status, recusa.mensagem);
    }
    const detalhe = omitirSegredos(await resposta.text(), [hermes.chave]).slice(0, 600);
    const mensagem =
      resposta.status === 401
        ? 'O Hermes recusou a chave (HTTP 401). Confira HERMES_API_KEY no .env.'
        : `O Hermes recusou o pedido para ${acao} (HTTP ${resposta.status}).`;
    throw new ErroHttp(502, mensagem, detalhe);
  }
  return resposta;
}

async function lerJsonDoHermes(resposta) {
  try {
    return await resposta.json();
  } catch (erro) {
    throw new ErroHttp(502, 'O Hermes respondeu com um corpo que não é JSON.', undefined, { cause: erro });
  }
}

// A última lista boa fica guardada sem prazo. Quando o cache do próprio Hermes vence, o /api/model/options leva até
// 6 s (medido em 08/10/2026); depois de 60 s o turno segue com a lista guardada e a nova vem em segundo plano.
let modelosEmCache = null;
let modelosChegando = null;
const PRAZO_SEM_LISTA_MS = 15_000;

export function esquecerModelos() {
  modelosEmCache = null;
  modelosChegando = null;
}

// O modelo que o perfil frank já usa: o model e o provider do topo do /api/model/options. Sem escolha no painel, o turno
// vai sem model e sem provider, e o Hermes usa este mesmo modelo, com o esforço do perfil (esforco null).
function padraoDoHermes(dados) {
  const modelo = typeof dados?.model === 'string' ? dados.model.trim() : '';
  if (!modelo) return null;
  const provedor = typeof dados.provider === 'string' && dados.provider.trim() ? dados.provider.trim() : null;
  return { provedor, modelo, esforco: null };
}

async function buscarModelos(fetchFn, hermes, { agora, timeoutMs }) {
  const resposta = await chamarHermes(fetchFn, hermes, '/api/model/options', { acao: 'listar os modelos', timeoutMs });
  const dados = await lerJsonDoHermes(resposta);
  const provedores = (Array.isArray(dados?.providers) ? dados.providers : [])
    .filter((provedor) => provedor?.authenticated === true && typeof provedor.slug === 'string' && Array.isArray(provedor.models))
    .map((provedor) => {
      const capacidades = provedor.capabilities ?? {};
      const modelos = provedor.models.filter((modelo) => typeof modelo === 'string');
      return {
        id: provedor.slug,
        nome: typeof provedor.name === 'string' && provedor.name ? provedor.name : provedor.slug,
        modelos,
        esforcos: Object.values(capacidades).some((capacidade) => capacidade?.reasoning === true) ? [...ESFORCOS] : [],
        // Modo fast do Hermes (prioridade na OpenAI, speed fast na Anthropic): ele diz modelo por modelo onde o provedor aceita.
        rapidos: modelos.filter((modelo) => capacidades[modelo]?.fast === true),
      };
    });
  const valor = { padrao: padraoDoHermes(dados), provedores };
  modelosEmCache = { base: hermes.base, ate: agora + VALIDADE_DOS_MODELOS_MS, valor };
  return valor;
}

export async function listarModelos(env, fetchFn = fetch, { agora = Date.now(), timeoutMs = PRAZO_SEM_LISTA_MS } = {}) {
  const hermes = exigirHermes(env);
  const guardada = modelosEmCache?.base === hermes.base ? modelosEmCache : null;
  if (guardada && guardada.ate > agora) return guardada.valor;
  if (!guardada) return buscarModelos(fetchFn, hermes, { agora, timeoutMs });
  if (!modelosChegando) {
    const chegando = buscarModelos(fetchFn, hermes, { agora, timeoutMs: PRAZO_SEM_LISTA_MS })
      .catch((erro) => console.warn(`[frank] a lista de modelos não atualizou; segue a anterior: ${erro.message}`))
      .finally(() => {
        if (modelosChegando === chegando) modelosChegando = null;
      });
    modelosChegando = chegando;
  }
  return guardada.valor;
}

const textoCurto = (valor, maximo = 80) => String(valor).slice(0, maximo);

// Só para o cérebro escolhido no painel. Sem escolha (null), quem decide é o perfil frank do Hermes: ver corpoDoRun.
export function resolverCerebro(cerebro, modelos) {
  if (typeof cerebro !== 'object' || cerebro === null || Array.isArray(cerebro)) {
    throw new ErroHttp(400, 'cerebro precisa ser um objeto com provedor, modelo e esforco.');
  }
  const { provedor, modelo, esforco } = cerebro;
  const doHermes = modelos.provedores.find((item) => item.id === provedor);
  if (!doHermes) {
    const conectados = modelos.provedores.map((item) => item.id).join(', ') || 'nenhum';
    throw new ErroHttp(400, `O provedor "${textoCurto(provedor)}" não está conectado no Hermes. Conectados: ${conectados}.`);
  }
  if (!doHermes.modelos.includes(modelo)) {
    throw new ErroHttp(400, `O modelo "${textoCurto(modelo)}" não está na lista do provedor ${doHermes.nome}.`);
  }
  // Fast pedido num modelo que não aceita (preferência salva antes de trocar de modelo) cai para o modo normal.
  const fast = cerebro.fast === true && (doHermes.rapidos ?? []).includes(modelo);
  const comFast = (resolvido) => (fast ? { ...resolvido, fast: true } : resolvido);
  if (doHermes.esforcos.length === 0) return comFast({ provedor, modelo, esforco: null });
  if (!doHermes.esforcos.includes(esforco)) {
    throw new ErroHttp(400, `esforco precisa ser um destes: ${doHermes.esforcos.join(', ')}.`);
  }
  return comFast({ provedor, modelo, esforco });
}

// instrucoes: vira o ephemeral_system_prompt do run (fim do prompt de sistema, sem gravar na sessão).
// cerebro null: o run vai sem model, provider e model_options, e o Hermes usa o modelo e o esforço do perfil frank.
// Fast vai como service_tier auto: o /v1/runs aceita fast: true, mas só a CLI, a TUI e o gateway de mensagens fixam esse
// tier no agente, e pela API ele não chega ao provedor. O auto abre a janela de agent.fast_auto_seconds (60 s) a cada
// turno, no loop de conversa comum a todas as entradas do Hermes.
export function corpoDoRun({ input, historico, cerebro, instrucoes }) {
  const opcoes = {
    ...(cerebro?.esforco ? { reasoning_effort: ESFORCO_NO_HERMES[cerebro.esforco] } : {}),
    ...(cerebro?.fast ? { service_tier: 'auto' } : {}),
  };
  return {
    input,
    conversation_history: historico,
    ...(cerebro ? { model: cerebro.modelo, provider: cerebro.provedor } : {}),
    ...(instrucoes ? { instructions: instrucoes } : {}),
    ...(Object.keys(opcoes).length > 0 ? { model_options: opcoes } : {}),
  };
}

export async function iniciarRun(fetchFn, hermes, corpo) {
  const resposta = await chamarHermes(fetchFn, hermes, '/v1/runs', { metodo: 'POST', corpo, acao: 'começar o turno do Frank' });
  const dados = await lerJsonDoHermes(resposta);
  if (typeof dados?.run_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(dados.run_id)) {
    throw new ErroHttp(502, 'O Hermes aceitou o turno, mas não devolveu um run_id válido.');
  }
  return dados.run_id;
}

// Só once e deny: session e always gravam permissão para os próximos comandos e furam a regra de uma autorização
// por ação. O request_id prende a resposta ao pedido que o dono viu; sem ele, o Hermes resolve o pedido mais antigo
// da fila (api_server_runs.py:1168). Sem pedido pendente, o Hermes devolve 409 (ou 404 se esqueceu o run).
export async function responderAprovacao(fetchFn, hermes, { runId, requestId, decisao }) {
  if (typeof requestId !== 'string' || !requestId.trim()) throw new ErroHttp(409, MOTIVO_SEM_AUTORIZACAO);
  const corpo = { choice: decisao === 'sim' ? 'once' : 'deny', request_id: requestId };
  await chamarHermes(fetchFn, hermes, `/v1/runs/${runId}/approval`, {
    metodo: 'POST',
    corpo,
    acao: 'responder a autorização',
    recusas: { 404: SEM_AUTORIZACAO, 409: SEM_AUTORIZACAO },
  });
}

// GET /v1/runs/{id}. null = o Hermes não conhece o run (esqueceu ou reiniciou); as outras falhas sobem.
export async function lerStatusDoRun(fetchFn, hermes, runId) {
  try {
    const resposta = await chamarHermes(fetchFn, hermes, `/v1/runs/${runId}`, { acao: 'conferir o turno do Frank', timeoutMs: 5000, recusas: { 404: RUN_ESQUECIDO } });
    return await lerJsonDoHermes(resposta);
  } catch (erro) {
    if (erro instanceof ErroHttp && erro.status === RUN_ESQUECIDO.status) return null;
    throw erro;
  }
}

// O status sozinho não basta: depois do timeout de aprovação o Hermes não emite nada e o run segue em
// waiting_for_approval com o pedido velho (api_server_runs.py:319), então quem chama também confere o que já foi decidido.
// Run esquecido não espera nada; sem resposta do Hermes, vale o pedido como pendente.
export async function aindaEsperaAutorizacao(fetchFn, hermes, { runId, requestId }) {
  let status;
  try {
    status = await lerStatusDoRun(fetchFn, hermes, runId);
  } catch {
    return true;
  }
  if (status?.status !== 'waiting_for_approval') return false;
  const pendente = status.approval?.request_id;
  return !requestId || !pendente || pendente === requestId;
}

// Quadros SSE do Hermes: `id:` + `data:` JSON, e comentários (`: open`, `: keepalive`, `: stream closed`).
export async function* lerQuadrosSse(corpo) {
  const leitor = corpo.pipeThrough(new TextDecoderStream()).getReader();
  let resto = '';
  try {
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) return;
      resto += value;
      let separador;
      while ((separador = /\r?\n\r?\n/.exec(resto))) {
        const bloco = resto.slice(0, separador.index);
        resto = resto.slice(separador.index + separador[0].length);
        const quadro = interpretarQuadro(bloco);
        if (quadro) yield quadro;
      }
    }
  } finally {
    leitor.cancel().catch(() => {});
  }
}

function interpretarQuadro(bloco) {
  const dados = [];
  const comentarios = [];
  for (const linha of bloco.split(/\r?\n/)) {
    if (linha.startsWith(':')) {
      comentarios.push(linha.slice(1).trim());
      continue;
    }
    const posicao = linha.indexOf(':');
    const campo = posicao < 0 ? linha : linha.slice(0, posicao);
    const valor = posicao < 0 ? '' : linha.slice(posicao + 1).replace(/^ /, '');
    if (campo === 'data') dados.push(valor);
  }
  if (dados.length) return { dados: dados.join('\n') };
  if (comentarios.length) return { comentario: comentarios.join(' ') };
  return null;
}

const semAcento = (nome) => nome.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

function idDoAgente(nome) {
  const id = semAcento(nome);
  return IDS_DO_TIME.includes(id) ? id : null;
}

// "[Renata] tarefa" → assistente renata. "[Revisão] tarefa" é passo interno do Frank, não um assistente.
export function separarAgente(goal) {
  const texto = typeof goal === 'string' ? goal : '';
  const prefixo = PREFIXO_DO_AGENTE.exec(texto);
  if (!prefixo) return { agente: null, tarefa: texto.trim(), revisao: false };
  return { agente: idDoAgente(prefixo[1]), tarefa: texto.slice(prefixo[0].length).trim(), revisao: semAcento(prefixo[1]) === PREFIXO_DA_REVISAO };
}

function lerJsonDaEntrega(texto) {
  const semCerca = texto.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/u, '$1');
  try {
    const json = JSON.parse(semCerca);
    return json && typeof json === 'object' && !Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

// Com o output_schema do SOUL.md, o summary chega como JSON { agente, titulo, texto, tipo, pendencias?, arquivo? };
// sem ele, é texto livre. O campo agente do JSON não decide nada: o assistente vem do prefixo do goal.
export function lerEntrega(summary, tarefa) {
  const texto = typeof summary === 'string' ? summary.trim() : '';
  const json = lerJsonDaEntrega(texto);
  if (typeof json?.texto !== 'string') return { titulo: tarefa, texto };
  const pendencias = Array.isArray(json.pendencias) ? json.pendencias.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()) : [];
  const arquivo = typeof json.arquivo === 'string' ? json.arquivo.trim() : '';
  return {
    titulo: typeof json.titulo === 'string' && json.titulo.trim() ? json.titulo.trim() : tarefa,
    texto: json.texto,
    ...(TIPOS_DE_ENTREGA.includes(json.tipo) ? { tipo: json.tipo } : {}),
    ...(pendencias.length ? { pendencias } : {}),
    ...(arquivo ? { arquivo } : {}),
  };
}

// O subagent.complete traz o summary cortado em 500 caracteres (Hermes 0.21.5, tools/delegate_tool_child_run.py:1001).
// A resposta final inteira do assistente fica na sessão dele. null = sem como ler; quem chama usa o summary do evento.
export async function lerResultadoDoFilho(fetchFn, hermes, sessaoId, { timeoutMs = 5000 } = {}) {
  if (typeof sessaoId !== 'string' || !ID_DA_SESSAO.test(sessaoId)) return null;
  try {
    const caminho = `/api/sessions/${encodeURIComponent(sessaoId)}/messages?order=latest&limit=${MENSAGENS_LIDAS_DA_SESSAO}`;
    const resposta = await chamarHermes(fetchFn, hermes, caminho, { acao: 'ler a entrega do assistente', timeoutMs });
    const mensagens = (await resposta.json())?.data;
    if (!Array.isArray(mensagens)) return null;
    // A página "latest" vem em ordem cronológica: a última fala do assistente é a resposta final.
    const final = mensagens.findLast((mensagem) => mensagem?.role === 'assistant' && typeof mensagem.content === 'string' && mensagem.content.trim());
    return final?.content ?? null;
  } catch {
    return null;
  }
}

const umaCasa = (segundos) => Math.round(Number(segundos) * 10) / 10;
const textoDoHermes = (valor) => (typeof valor === 'string' ? valor : '');

// "MEDIA:<caminho>" numa linha é como o Hermes anexa imagem (o print do computer use, por exemplo). A fala vai à voz
// e ao painel só com o texto; com a linha, a voz leria o caminho do arquivo.
const LINHA_DE_ANEXO = /^[ \t]*MEDIA:.*(?:\r?\n|$)/gm;

function falaSemAnexos(texto) {
  const semAnexos = texto.replace(LINHA_DE_ANEXO, '');
  // A linha sai com a quebra dela; com uma linha em branco de cada lado, sobrariam duas seguidas.
  return (semAnexos === texto ? texto : semAnexos.replace(/\n{3,}/g, '\n\n')).trim();
}

function resumir(preview) {
  return typeof preview === 'string' && preview ? { resumo: preview.slice(0, LIMITE_DO_RESUMO) } : {};
}

// Evento bruto do Hermes → evento do painel. null = não vai ao painel.
export function normalizarEvento(evento, { iniciadoEm, agora = Date.now() } = {}) {
  switch (evento?.event) {
    case 'tool.started':
    case 'tool.completed':
      return { tipo: 'ferramenta', nome: String(evento.tool ?? ''), fase: evento.event === 'tool.started' ? 'inicio' : 'fim', ...resumir(evento.preview) };
    // Filho [Revisão] (ou entrega com tipo revisao) é passo interno do Frank: sai como ferramenta, nunca como entrega.
    case 'subagent.start': {
      const { agente, tarefa, revisao } = separarAgente(evento.goal);
      if (revisao) return { tipo: 'ferramenta', nome: PREFIXO_DA_REVISAO, fase: 'inicio', ...resumir(tarefa) };
      return { tipo: 'agente_inicio', agente, tarefa, subagenteId: String(evento.subagent_id ?? '') };
    }
    case 'subagent.complete': {
      const { agente, tarefa, revisao } = separarAgente(evento.goal);
      const entrega = lerEntrega(evento.summary, tarefa);
      if (revisao || entrega.tipo === 'revisao') return { tipo: 'ferramenta', nome: PREFIXO_DA_REVISAO, fase: 'fim', ...resumir(entrega.texto) };
      return {
        tipo: 'agente_fim',
        agente,
        subagenteId: String(evento.subagent_id ?? ''),
        status: evento.status === 'completed' ? 'ok' : 'erro',
        entrega,
        duracaoS: umaCasa(evento.duration_seconds ?? 0),
      };
    }
    // command e description chegam redigidos pelo Hermes. O comando vai inteiro: cortar o que o dono autoriza
    // esconderia justo o trecho perigoso. A descrição conhecida vai em PT-BR.
    case 'approval.request':
      return { tipo: 'aprovacao', comando: textoDoHermes(evento.command), descricao: descricaoEmPortugues(textoDoHermes(evento.description)) };
    case 'approval.responded':
      return Object.hasOwn(DECISAO_DO_HERMES, evento.choice) ? { tipo: 'aprovacao_fim', decisao: DECISAO_DO_HERMES[evento.choice] } : null;
    case 'message.delta':
      return typeof evento.delta === 'string' ? { tipo: 'texto', delta: evento.delta } : null;
    // O que o Frank escreve ao lado das ferramentas, no meio do turno ("Deixa eu conferir isso agora."): vale para todo
    // provedor (agent/turn_tool_round.py do Hermes). A voz fala na hora; a resposta final segue no run.completed.
    case 'message.interim': {
      const fala = falaSemAnexos(textoDoHermes(evento.text));
      return fala ? { tipo: 'andamento', texto: fala } : null;
    }
    case 'run.completed':
      return {
        tipo: 'fim',
        fala: falaSemAnexos(textoDoHermes(evento.output)),
        provedor: evento.runtime?.provider ?? null,
        modelo: evento.runtime?.model ?? null,
        duracaoS: iniciadoEm ? umaCasa((agora - Date.parse(iniciadoEm)) / 1000) : null,
      };
    default:
      if (Object.hasOwn(FIM_DO_TURNO, evento?.event)) {
        return { tipo: 'erro', mensagem: `O turno no Hermes ${FIM_DO_TURNO[evento.event]} antes de terminar. Tenta de novo?` };
      }
      return null;
  }
}
