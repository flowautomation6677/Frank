// Trava anti-promessa. O Hermes não tem gancho de fim de turno para isso: o pre_verify só
// dispara quando o turno editou arquivo (agent/turn_stop_gates.py:55). Então a ponte confere a fala final.

export const TEXTO_DO_EMPURRAO =
  'Você terminou prometendo uma ação sem chamar ferramenta nenhuma. Faça agora o que prometeu: você mesmo, com as suas ferramentas, ou, se for pedido claro de trabalho do time, passando para o time do jeito de sempre; e responda numa frase com o que fez ou passou adiante. Se não há o que fazer, responda sem prometer.';

// Fronteira de palavra que reconhece letra acentuada (o \b do JavaScript não reconhece).
const padrao = (corpo) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${corpo.replaceAll(' ', '\\s+')})(?![\\p{L}\\p{N}])`, 'iu');

const PROMESSAS = [
  // Falar, contar ou explicar se cumpre na própria fala: "vou falar" para a galera não é promessa.
  'vou (?:pedir|passar|chamar|mandar|ver|preparar|montar|fazer|criar|escrever|resolver|ajustar|conferir)',
  'j[áa] (?:passo|pe[çc]o|chamo|mando|vejo|fa[çc]o|monto|resolvo|te (?:volto|retorno|respondo))',
  'deixa comigo',
  'pode deixar que',
  'daqui a pouco',
  'em instantes',
  '(?:um|uns) (?:minuto|minutinho|segundo|instante|momento)s?',
  'falta (?:s[óo] )?(?:terminar|finalizar|fazer)',
  'ainda (?:preciso|falta|tenho que)',
  'em seguida (?:vou|eu)',
].map(padrao);

const SINAIS_DE_ENTREGA = [
  'passei',
  'pedi',
  'chamei',
  'mandei',
  'entregou',
  'entregaram',
  'pronto',
  'feito',
  '(?:t[áa]|est[áa]) em ["“]?para aprovar',
].map(padrao);

export const prometeAcao = (fala) => PROMESSAS.some((regra) => regra.test(fala));
export const temSinalDeEntrega = (fala) => SINAIS_DE_ENTREGA.some((regra) => regra.test(fala));

// Empurra só quando as três valem: a fala promete ação, o run não chamou ferramenta nenhuma e não há sinal de entrega.
// Run com terminal, navegador ou computer use sem delegate_task é o Frank agindo sozinho.
export function precisaDeEmpurrao(fala, { usouFerramenta }) {
  if (usouFerramenta || typeof fala !== 'string' || !fala.trim()) return false;
  return prometeAcao(fala) && !temSinalDeEntrega(fala);
}
