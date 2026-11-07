---
name: consultar-banco
description: 'Use antes de escrever para cliente, responder lead, montar oferta, anúncio, página, post ou relatório, e sempre que faltar produto, preço, oferta, público, voz da marca, regra de desconto ou garantia: ler o arquivo certo do banco de conhecimento da empresa em vez de inventar ou bloquear.'
version: 1.0.0
author: Imersão Time de Agentes de IA
license: MIT
metadata:
  hermes:
    tags: [time-do-frank, banco-de-conhecimento]
    config:
      - key: banco.dir
        description: Pasta do banco de conhecimento da empresa (um assunto por arquivo)
        default: "/home/hermes/empresa/banco"
        prompt: Onde fica a pasta do banco de conhecimento da empresa?
---

# Consultar o banco de conhecimento


## Quando usar

- Antes de qualquer texto que vai para cliente ou lead.
- Quando o pedido cita produto, preço, oferta, lote, garantia, desconto, público ou integração.
- Antes de dizer "BLOQUEADO: falta produto, preço ou oferta": primeiro procure aqui.

## Referência rápida

A pasta vem da configuração `banco.dir` (o Hermes mostra o valor como "Skill config" ao carregar esta skill).

| Preciso de | Arquivo |
|---|---|
| Quem é a empresa, donos, números citáveis, metas, concorrentes e referências | `empresa.md` |
| Produto, preço, lotes, entregáveis, checkout | `produtos-e-precos.md` |
| Campanha que vale agora, prazo, bônus, meta | `oferta-atual.md` |
| Público, dores, objeções, critério de lead | `publico-e-dores.md` |
| Tom, frases certas e proibidas, promessas aprovadas | `voz-da-marca.md` (seção Promessas aprovadas) |
| O que o Vitor responde, o que vai para gente, desconto, reembolso, garantia | `regras-da-casa.md` |
| Resposta pronta para pergunta comum | `perguntas-frequentes.md` |
| Depoimento e número com autorização | `provas-e-depoimentos.md` |
| O que está conectado de verdade | `canais-e-integracoes.md` |

## Procedimento

1. Leia com `read_file` só o arquivo do assunto (não o banco inteiro).
2. Use o dado como está. Não arredonde preço, não "melhore" depoimento.
3. Promessa comercial vem só da seção "## Promessas aprovadas" de `voz-da-marca.md` ou `oferta-atual.md`. Use com força as promessas aprovadas; não invente promessa que não está lá. Promessa nova vai para o dono pelo Frank.
4. Está escrito "a definir pelo dono" ou o arquivo não tem o dado: diga "não está no banco: <o quê>" e peça ao Frank (assistentes) ou ao dono (Frank), em vez de supor.
5. Integração marcada como não conectada em `canais-e-integracoes.md`: trabalhe em rascunho e diga "BLOQUEADO: falta <integração>".

## Rótulos de status (valem para todo o time)

| Rótulo | Quando usar |
|---|---|
| PARA APROVAR | A entrega está pronta e espera o ok do dono |
| FALTA NO BANCO | O dado não está no banco ou está "a definir pelo dono" |
| BLOQUEADO | Algo ficou de fato travado por integração ausente (token, conta, programa) |

Se nada ficou bloqueado, não escreva a linha de BLOQUEADO. Nunca "BLOQUEADO: nenhum" nem "BLOQUEADO: nada".

## Armadilhas

- O banco é do dono. Assistente não edita arquivo do banco; sugere a mudança ao Frank. Só o Frank grava, e só o que o dono disse, pela skill `onboarding-da-empresa`.
- A pasta do banco não existe ou está vazia: diga "FALTA NO BANCO: o banco da empresa ainda não foi criado". O Frank cria na primeira conversa com o dono.
- Dado de cliente não entra no banco.

## Verificação

- A resposta cita de qual arquivo saiu cada preço, prazo, regra ou promessa.
