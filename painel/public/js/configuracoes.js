import { cerebroDoPedido, cerebroEmUso, custoDoCerebro, esforcoValido, fastDisponivel, nomeDoProvedor, notaDaEscuta, rotuloDoCerebro, rotuloDoEsforco } from './painel-logica.js';
import { PREFERENCIAS_PADRAO } from './preferencias.js';

const ESPERA_MINIMA = 15;
const ESPERA_MAXIMA = 1800;
const NOTA_DO_FAST = 'Responde mais rápido no primeiro minuto de cada pedido e gasta mais.';
const NOTA_SEM_FAST = 'Este modelo não tem modo fast no Hermes.';
const CARREGANDO_AS_VOZES = 'Carregando as vozes do servidor…';
const comMaiuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

function abrirDialogo(dialogo, gatilho) {
  dialogo.addEventListener('close', () => gatilho?.focus?.(), { once: true });
  dialogo.showModal();
}

export function criarPedidoDeCodigo({ dialogo, entrada }) {
  let pendente = null;
  return function pedirCodigo() {
    if (pendente) return pendente;
    pendente = new Promise((resolver) => {
      entrada.value = '';
      dialogo.addEventListener('close', () => {
        const codigo = dialogo.returnValue === 'entrar' ? entrada.value.trim() : '';
        pendente = null;
        resolver(codigo || null);
      }, { once: true });
      dialogo.showModal();
    });
    return pendente;
  };
}

export function abrirAjuda(dialogo, gatilho) {
  abrirDialogo(dialogo, gatilho);
}

// obterModelos() → { dados, erro } com a resposta de /api/frank/modelos; recarregarModelos() busca de novo.
// obterEscuta() → situação da escuta do chamado (estado dela, ou 'sem-microfone' antes da permissão).
export function criarConfiguracoes({ dialogo, obterPreferencias, alterarPreferencias, obterConfig, obterModelos, recarregarModelos, obterSessaoAtiva, exigeCodigo, obterEscuta }) {
  const campo = (id) => document.getElementById(id);
  const nome = campo('cfg-nome');
  const provedor = campo('cfg-provedor');
  const modelo = campo('cfg-modelo');
  const esforco = campo('cfg-esforco');
  const fast = campo('cfg-fast');
  const fastNota = campo('cfg-fast-nota');
  const cerebroNota = campo('cfg-cerebro-nota');
  const cerebroPadrao = campo('cfg-cerebro-padrao');
  const vozGemini = campo('cfg-voz-gemini');
  const vozGeminiNota = campo('cfg-voz-gemini-nota');
  const vozGptCampo = campo('cfg-voz-gpt-campo');
  const vozGpt = campo('cfg-voz-gpt');
  const vozGptNota = campo('cfg-voz-gpt-nota');
  const acordar = campo('cfg-acordar');
  const chamar = campo('cfg-chamar');
  const chamarNota = campo('cfg-chamar-nota');
  const espera = campo('cfg-espera');
  const codigoCampo = campo('cfg-codigo-campo');
  const codigo = campo('cfg-codigo');
  // FRANK_NOME_DO_DONO do servidor: o campo mostra esse nome enquanto ninguém digitar outro neste navegador.
  const nomeDoServidor = () => obterConfig()?.dono?.nome ?? '';

  function aviso(elemento, texto, tipo) {
    elemento.textContent = texto;
    if (tipo) elemento.dataset.tipo = tipo;
    else delete elemento.dataset.tipo;
  }

  function mostrarNotaDaEscuta() {
    const nota = notaDaEscuta(obterEscuta?.());
    aviso(chamarNota, nota.texto, nota.alerta ? 'alerta' : undefined);
  }

  function avisoProximaSessao() {
    return obterSessaoAtiva() ? ' Vale a partir da próxima vez que o Frank acordar.' : '';
  }

  // Quem paga o cérebro abre a nota; quando é o provedor, a frase ganha destaque discreto (sem o vermelho de erro).
  function notaDoCerebro(custo, complemento) {
    const frase = document.createElement('span');
    frase.className = 'cerebro-custo';
    frase.textContent = custo.nota;
    cerebroNota.replaceChildren(frase, complemento ? ` ${complemento}` : '');
    if (custo.assinatura) delete cerebroNota.dataset.tipo;
    else cerebroNota.dataset.tipo = 'cobranca';
  }

  // Provedor → modelo → esforço, com a lista que o Hermes conectado devolve.
  function montarCerebro() {
    const { dados, erro } = obterModelos();
    const provedores = Array.isArray(dados?.provedores) ? dados.provedores.filter((item) => item?.modelos?.length) : [];
    const preferido = obterPreferencias().cerebro;
    if (provedores.length === 0) {
      for (const select of [provedor, modelo, esforco]) {
        select.replaceChildren(new Option('Indisponível', ''));
        select.disabled = true;
      }
      fast.checked = false;
      fast.disabled = true;
      const texto = erro || (dados ? 'Nenhum provedor conectado no Hermes. Conecte um lá e abra de novo.' : 'Lendo os modelos do Hermes…');
      aviso(cerebroNota, texto, erro || dados ? 'alerta' : null);
      cerebroPadrao.hidden = !preferido;
      return;
    }
    const emUso = cerebroEmUso(preferido, dados);
    const atual = provedores.find((item) => item.id === emUso?.provedor) ?? provedores[0];
    provedor.replaceChildren(...provedores.map((item) => new Option(nomeDoProvedor(item), item.id)));
    provedor.value = atual.id;
    provedor.disabled = false;
    modelo.replaceChildren(...atual.modelos.map((id) => new Option(id, id)));
    modelo.value = atual.modelos.includes(emUso?.modelo) ? emUso.modelo : atual.modelos[0];
    modelo.disabled = false;
    const esforcos = Array.isArray(atual.esforcos) ? atual.esforcos : [];
    esforco.replaceChildren(...(esforcos.length ? esforcos.map((id) => new Option(comMaiuscula(rotuloDoEsforco(id)), id)) : [new Option('Não se aplica', '')]));
    esforco.value = esforcoValido(atual, emUso?.esforco) ?? '';
    esforco.disabled = esforcos.length === 0;
    const aceitaFast = fastDisponivel(atual, modelo.value);
    fast.checked = aceitaFast && emUso?.fast === true;
    fast.disabled = !aceitaFast;
    fastNota.textContent = aceitaFast ? NOTA_DO_FAST : NOTA_SEM_FAST;

    const padrao = dados.padrao?.modelo ? `Padrão do Hermes: ${rotuloDoCerebro(dados.padrao)}.` : '';
    if (preferido && !cerebroDoPedido(preferido, dados)) {
      aviso(cerebroNota, `O modelo salvo (${preferido.modelo}) saiu da lista do Hermes; o Frank usa o padrão.`, 'alerta');
    } else {
      notaDoCerebro(custoDoCerebro(emUso ?? { provedor: atual.id }, dados), padrao);
    }
    cerebroPadrao.hidden = !preferido;
  }

  function escolherCerebro() {
    const dados = obterModelos().dados;
    const alvo = dados?.provedores?.find((item) => item.id === provedor.value);
    if (!alvo?.modelos?.length) return;
    const padrao = dados.padrao ?? {};
    let modeloEscolhido = modelo.value;
    if (!alvo.modelos.includes(modeloEscolhido)) {
      modeloEscolhido = padrao.provedor === alvo.id && alvo.modelos.includes(padrao.modelo) ? padrao.modelo : alvo.modelos[0];
    }
    const escolha = { provedor: alvo.id, modelo: modeloEscolhido, esforco: esforcoValido(alvo, esforco.value || padrao.esforco) };
    if (fast.checked && fastDisponivel(alvo, modeloEscolhido)) escolha.fast = true;
    const igualAoPadrao = padrao.provedor === escolha.provedor && padrao.modelo === escolha.modelo && (padrao.esforco ?? null) === escolha.esforco && !escolha.fast;
    alterarPreferencias({ cerebro: igualAoPadrao ? null : escolha });
    montarCerebro();
    notaDoCerebro(custoDoCerebro(escolha, dados), `O Frank pensa com ${rotuloDoCerebro(escolha)} a partir do próximo pedido.`);
  }

  function montarVozGemini() {
    if (!obterConfig()) {
      vozGemini.replaceChildren(new Option('Carregando…', ''));
      vozGemini.disabled = true;
      aviso(vozGeminiNota, CARREGANDO_AS_VOZES);
      return;
    }
    const info = obterConfig()?.motores?.geminiLive;
    const vozes = info?.vozes ?? [];
    vozGemini.replaceChildren(...vozes.map((voz) => new Option(voz.nome, voz.id)));
    vozGemini.disabled = vozes.length === 0;
    const atual = obterPreferencias().vozGemini;
    vozGemini.value = vozes.some((voz) => voz.id === atual) ? atual : info?.vozPadrao ?? '';
    aviso(vozGeminiNota, info?.disponivel ? '' : info?.motivo ?? '', info?.disponivel ? null : 'alerta');
  }

  // O GPT Live é opcional: sem OPENAI_API_KEY no servidor, a escolha da voz dele nem aparece.
  function montarVozGpt() {
    vozGptCampo.hidden = !obterConfig()?.motores?.gptLive?.disponivel;
    if (!obterConfig()) {
      vozGpt.replaceChildren(new Option('Carregando…', ''));
      vozGpt.disabled = true;
      aviso(vozGptNota, CARREGANDO_AS_VOZES);
      return;
    }
    const info = obterConfig()?.motores?.gptLive;
    const vozes = info?.vozes ?? [];
    vozGpt.replaceChildren(...vozes.map((voz) => new Option(voz, voz)));
    vozGpt.disabled = vozes.length === 0;
    const atual = obterPreferencias().vozGptLive;
    vozGpt.value = vozes.includes(atual) ? atual : info?.vozPadrao ?? '';
    aviso(vozGptNota, info?.disponivel ? '' : info?.motivo ?? '', info?.disponivel ? null : 'alerta');
  }

  function sincronizar() {
    const preferencias = obterPreferencias();
    nome.value = preferencias.nome || nomeDoServidor();
    montarCerebro();
    acordar.checked = preferencias.acordarAoAbrir;
    chamar.checked = preferencias.acordarAoChamar;
    mostrarNotaDaEscuta();
    espera.value = String(preferencias.esperaSegundos);
    for (const opcao of dialogo.querySelectorAll('input[name="tema"]')) opcao.checked = opcao.value === preferencias.tema;
    codigo.value = preferencias.codigo;
    codigoCampo.hidden = !(exigeCodigo() || preferencias.codigo);
    montarVozGemini();
    montarVozGpt();
  }

  // Em branco ou igual ao do servidor, nada fica salvo aqui e vale o FRANK_NOME_DO_DONO.
  nome.addEventListener('change', () => {
    const digitado = nome.value.trim();
    alterarPreferencias({ nome: digitado === nomeDoServidor() ? '' : digitado });
  });
  for (const select of [provedor, modelo, esforco, fast]) select.addEventListener('change', escolherCerebro);
  cerebroPadrao.addEventListener('click', () => {
    alterarPreferencias({ cerebro: null });
    montarCerebro();
    provedor.focus();
  });
  vozGemini.addEventListener('change', () => {
    alterarPreferencias({ vozGemini: vozGemini.value });
    aviso(vozGeminiNota, avisoProximaSessao().trim());
  });
  vozGpt.addEventListener('change', () => {
    alterarPreferencias({ vozGptLive: vozGpt.value });
    aviso(vozGptNota, avisoProximaSessao().trim());
  });
  acordar.addEventListener('change', () => alterarPreferencias({ acordarAoAbrir: acordar.checked }));
  chamar.addEventListener('change', () => {
    alterarPreferencias({ acordarAoChamar: chamar.checked });
    mostrarNotaDaEscuta();
  });
  espera.addEventListener('change', () => {
    const segundos = Math.min(ESPERA_MAXIMA, Math.max(ESPERA_MINIMA, Math.round(Number(espera.value) || PREFERENCIAS_PADRAO.esperaSegundos)));
    espera.value = String(segundos);
    alterarPreferencias({ esperaSegundos: segundos });
  });
  for (const opcao of dialogo.querySelectorAll('input[name="tema"]')) {
    opcao.addEventListener('change', () => alterarPreferencias({ tema: opcao.value }));
  }
  codigo.addEventListener('change', () => alterarPreferencias({ codigo: codigo.value.trim() }));

  return {
    abrir(gatilho) {
      sincronizar();
      abrirDialogo(dialogo, gatilho);
      // Provedor conectado no Hermes aparece sozinho: a lista é relida a cada abertura.
      const antes = JSON.stringify(obterModelos().dados ?? null);
      recarregarModelos?.().then(() => {
        if (dialogo.open && JSON.stringify(obterModelos().dados ?? null) !== antes) montarCerebro();
      });
    },
    sincronizar,
    atualizarCerebro: montarCerebro,
    atualizarEscuta() {
      if (dialogo.open) mostrarNotaDaEscuta();
    },
    // Chamado quando /api/config responde: troca o "carregando" das vozes pela lista, se o diálogo estiver aberto.
    atualizarVozes() {
      if (!dialogo.open) return;
      montarVozGemini();
      montarVozGpt();
    },
  };
}
