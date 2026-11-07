---
name: onboarding-da-empresa
description: "Use na primeira conversa com o dono, ou quando ele pedir 'refaz o onboarding', 'atualiza o briefing', 'atualiza o banco', 'mudou a minha oferta', 'mudou o preço': conhecer a empresa com uma pergunta de cada vez e gravar as respostas no banco de conhecimento que os 8 agentes leem."
version: 1.0.0
author: Imersão Time de Agentes de IA
license: MIT
metadata:
  hermes:
    tags: [time-do-frank, banco-de-conhecimento, onboarding]
    related_skills: [consultar-banco, distribuir-pedido]
    config:
      - key: banco.dir
        description: Pasta do banco de conhecimento da empresa (um assunto por arquivo)
        default: "/home/hermes/empresa/banco"
        prompt: Onde fica a pasta do banco de conhecimento da empresa?
---

# Onboarding da empresa


## Quando usar

- Primeira conversa com o dono pelo Telegram: a minha memória ainda não tem a linha "Onboarding da empresa: concluído" nem "Onboarding da empresa: parado".
- O dono pediu: "refaz o onboarding", "atualiza o briefing", "atualiza o banco", "mudou a minha oferta", "mudou o preço".
- O onboarding parou no meio e o dono disse "vamos continuar o onboarding".
- Só na conversa com o dono. Rotina agendada, cartão do Kanban e comando no terminal seguem o pedido normal.

## Referência rápida

- Pasta do banco: a configuração `banco.dir` (o Hermes mostra como "Skill config" ao carregar esta skill).
- Criar o banco, se ainda não existe: `python3 ${HERMES_SKILL_DIR}/scripts/preparar_banco.py criar --banco <banco.dir>`
- Ver o que falta, bloco por bloco: `python3 ${HERMES_SKILL_DIR}/scripts/preparar_banco.py situacao --banco <banco.dir>`
- O script nunca sobrescreve um banco que já tem arquivos. O que o dono ainda não disse fica "a definir pelo dono".

| Bloco                            | Grava em                                           |
| -------------------------------- | -------------------------------------------------- |
| 1. Dados básicos                 | `empresa.md`                                       |
| 2. Oferta                        | `produtos-e-precos.md` e `oferta-atual.md`         |
| 3. Cliente ideal                 | `publico-e-dores.md` e `perguntas-frequentes.md`   |
| 4. Marca, tom de voz e promessas | `voz-da-marca.md` e `provas-e-depoimentos.md`      |
| 5. Canais                        | `canais-e-integracoes.md`                          |
| 6. Regras do time                | `regras-da-casa.md`                                |
| 7. Metas e momento               | `empresa.md` (Metas e momento) e `oferta-atual.md` |
| 8. Concorrentes e referências    | `empresa.md` (Concorrentes e referências)          |

## Procedimento

1. Rode `situacao`. Se o banco não existe, rode `criar` e depois `situacao` de novo.
2. Se `situacao` avisar que existe um `briefing.md` ao lado do banco, leia esse arquivo e passe para o banco o que ele já tem, sem perguntar de novo.
3. O que veio da página de instalação (nome do dono, empresa, o que vende, público, tom de voz e palavras proibidas) já está no banco. Mostre o que tem e pergunte só se está certo.
4. Mande a abertura e siga os blocos na ordem, pulando os que `situacao` mostrar sem nada "a definir".
5. Uma pergunta por mensagem, curta, com um exemplo de resposta. Nunca mande a lista inteira.
6. Ao fim de cada bloco, grave os arquivos do bloco com a ferramenta de arquivo: troque só a linha "a definir pelo dono" que o dono respondeu e mantenha o resto. Diga em uma linha quanto falta, por exemplo "Faltam 3 blocos, uns 5 minutos."
7. Pedido de mudança depois do onboarding ("mudou o preço"): grave só o arquivo daquele assunto, mostre a linha antes e depois e confirme com o dono.

## Abertura

Adapte o nome e mande:

"Oi, {nome}! Antes do primeiro pedido, quero conhecer a sua empresa. São 8 blocos curtos, uma pergunta de cada vez, uns 15 minutos. Tudo o que você responder vai para o banco de conhecimento que os 8 agentes do time leem antes de trabalhar. Pode responder curto ou dizer 'pula'. Se precisar parar, é só dizer 'depois'. Vamos?"

## Os 8 blocos e as perguntas

1. Dados básicos
   - Confirme o nome da empresa e o nome do dono. Pergunte a cidade e o estado.
   - Há quanto tempo a empresa existe e quem da equipe cuida de quê (quem resolve reclamação, desconto, dúvida técnica)?
   - Os links: site, Instagram e WhatsApp comercial. Horário de atendimento de gente.
2. Oferta
   - Quais produtos ou serviços você vende? Nome e preço de cada um, exatamente como no checkout.
   - Qual é o carro-chefe? Como a pessoa compra e paga (link, WhatsApp, Pix, cartão, parcelas)?
   - O que a pessoa recebe depois de pagar? Garantia e prazo de entrega.
   - Tem campanha ou promoção valendo agora? Até quando, por quanto, com qual bônus?
3. Cliente ideal
   - Quem é o seu melhor cliente? Peça as palavras que o próprio cliente usa.
   - Que problema ele quer resolver quando te procura? O que faz ele travar na hora de comprar?
   - Quais perguntas todo cliente faz antes de comprar? Qual a resposta que a empresa dá?
   - Quem não é seu cliente? O que faz um lead valer uma conversa com gente?
4. Marca, tom de voz e promessas
   - Confirme o tom de voz e peça um texto ou post com a cara da marca (colado ou o link).
   - Confirme as palavras proibidas. Trata o cliente por você, tu ou senhor e senhora? Usa emoji?
   - Quais promessas o time pode fazer com força em anúncio, página e atendimento? Peça as palavras exatas e o que sustenta cada uma. Elas vão para "## Promessas aprovadas".
   - Tem depoimento de cliente com autorização para uso público? Copie as palavras sem melhorar.
5. Canais
   - Onde a empresa vende e divulga hoje? Instagram, WhatsApp, site, loja, anúncios, marketplace.
   - Já anuncia no Meta ou no Google? Quanto investe por mês, mais ou menos?
   - Marque como conectado só o que está ligado no servidor de verdade. O resto fica "não".
6. Regras do time
   - O padrão é: nada vai para o ar sem o seu ok. Quer liberar alguma coisa para rodar sozinha? Escreva o limite.
   - Teto de gasto em anúncio, por dia ou por mês, que o Breno nunca passa.
   - Desconto e reembolso: qual a regra, e quem executa?
   - Assuntos que só o dono resolve. O padrão é desconto, verba nova, exceção e reclamação séria.
7. Metas e momento
   - Qual é a meta dos próximos 90 dias? Faturamento, clientes ou seguidores.
   - Tem lançamento ou data importante chegando?
8. Concorrentes e referências
   - Dois ou três concorrentes, com o nome ou o @.
   - Marcas que você admira e quer como referência.

## No fim

1. Rode `situacao` e confira que nada ficou em branco sem ser "a definir pelo dono".
2. Registre na memória: "Onboarding da empresa: concluído em DD/MM/AAAA. Banco em <banco.dir>."
3. Mande ao dono um resumo de até 10 linhas: o que entendeu da empresa, as promessas aprovadas, as regras combinadas e o que ficou "a definir pelo dono".
4. Diga como mudar depois: "Se algo mudar, é só me dizer 'Frank, atualiza o briefing' ou 'Frank, refaz o onboarding'."
5. Sugira o primeiro pedido, com 2 ou 3 exemplos ligados à meta que ele contou.

## Se o dono parar no meio

- Grave o que já tem.
- Registre na memória: "Onboarding da empresa: parado no bloco N em DD/MM/AAAA. Continuar quando o dono pedir."
- Responda: "Tudo bem. Quando quiser continuar, é só dizer 'vamos continuar o onboarding'."
- Se ele fizer um pedido antes de terminar, atenda com o que já tem e pergunte só o que faltar para aquele pedido.
- Ao continuar, rode `situacao` e comece do primeiro bloco com itens "a definir". No fim, troque a linha da memória pela de concluído.

## Armadilhas

- Não invente nada. "Não sei" e "pula" viram "a definir pelo dono", e eu sigo.
- Promessa que o dono não disse não entra em "## Promessas aprovadas". Os outros agentes só prometem o que está lá.
- Preço, prazo e desconto entram exatamente como o dono escreveu. Não arredonde.
- Não grave senha, chave, token, CPF nem dado de cliente no banco.
- Não apague as notas "Como preencher" dos arquivos: elas orientam o dono quando ele abrir o banco.
- Se o dono colar um texto pronto com várias respostas, aproveite tudo e pergunte só o que faltou.

## Verificação

- `situacao` mostra os 9 arquivos e menos itens "a definir" do que antes do onboarding.
- Cada resposta do dono está no arquivo do assunto, com as palavras dele.
- A memória tem a linha de concluído, ou a de parado com o número do bloco.
