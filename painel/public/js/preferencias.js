const CHAVE = 'painel-do-frank:preferencias';

export const PREFERENCIAS_PADRAO = Object.freeze({
  // Em branco, o Frank usa o FRANK_NOME_DO_DONO do servidor (ou nenhum nome, se ele também faltar).
  nome: '',
  // Cérebro escolhido no Hermes ({ provedor, modelo, esforco, fast? }); null = o padrão do perfil do Frank no Hermes.
  cerebro: null,
  demandaId: null,
  // geminiLive ou gptLive: os dois entregam ao Hermes, e o Gemini Live custa menos.
  motor: 'geminiLive',
  vozGemini: '',
  vozGptLive: '',
  // A voz é a única API paga: abrir a página não acorda o Frank, e a sessão dorme logo depois da última fala.
  acordarAoAbrir: false,
  esperaSegundos: 20,
  acordarAoChamar: true,
  tema: 'escuro',
  codigo: '',
});

export function lerPreferencias() {
  try {
    const lidas = JSON.parse(localStorage.getItem(CHAVE) ?? '{}');
    const salvas = lidas && typeof lidas === 'object' && !Array.isArray(lidas) ? lidas : {};
    return { ...PREFERENCIAS_PADRAO, ...salvas };
  } catch (erro) {
    console.warn('Preferências ilegíveis ou storage bloqueado; usando o padrão.', erro);
    return { ...PREFERENCIAS_PADRAO };
  }
}

export function salvarPreferencias(preferencias) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(preferencias));
    return true;
  } catch (erro) {
    console.warn('Não deu para salvar as preferências neste navegador.', erro);
    return false;
  }
}
