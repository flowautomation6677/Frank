---
name: distribuir-pedido
description: Use quando o dono fizer um pedido novo e for preciso quebrar em tarefas e distribuir aos assistentes pelo quadro Kanban.
---

# Distribuir um pedido ao time

## Quando usar

- O dono pediu algo novo: uma campanha, uma página, anúncios, uma promoção, um ajuste.
- Um pedido grande precisa virar várias tarefas com responsável e prazo.
- Uma entrega voltou do dono com ajuste e precisa ser redistribuída.

## Passo a passo

1. Leia o pedido inteiro e escreva o objetivo em uma frase. Se estiver ambíguo, faça uma pergunta objetiva ao dono antes de seguir.
2. Consulte o banco da empresa com a skill `consultar-banco`: `empresa.md`, `oferta-atual.md` e o que o pedido tocar. Se faltar o que a empresa vende ou para quem, pergunte ao dono antes de distribuir.
3. Liste o que precisa existir para o pedido ficar pronto: plano, texto, página, posts, anúncios, atendimento, medição.
4. Escolha o assistente de cada item:
   - `ulisses`: oferta, posicionamento, público e plano.
   - `renata`: textos de anúncio, página, e-mail e roteiro.
   - `marina`: páginas de captura e de venda.
   - `lara`: posts, carrosséis e Reels.
   - `breno`: anúncios no ar e acompanhamento da conta.
   - `vitor`: atendimento dos leads no WhatsApp e no Direct.
   - `isabela`: números da manhã seguinte.
5. Ordene pelas dependências: Ulisses planeja, Renata escreve, Marina e Lara produzem, Breno coloca no ar, Vitor atende, Isabela mede.
6. Crie uma tarefa no quadro Kanban para cada assistente, com `assignee` igual ao nome do perfil em minúsculas e `skills: ["consultar-banco"]`, para a tarefa já nascer lendo o banco.
7. Em cada tarefa escreva: objetivo, contexto mínimo, o trecho do banco que importa para aquela tarefa, com o nome do arquivo de onde saiu (oferta, cliente, tom de voz, regras), o que já foi decidido, prazo, o que não pode fazer e o critério de pronto.
8. Registre as dependências na descrição, por exemplo "só começa depois da entrega da Renata".
9. Avise no grupo do time: para cada tarefa criada, rode `time-do-frank avisar <perfil> "Frank chamou <Nome>: <objetivo em uma linha>"`. Sem grupo montado, o comando responde "sem grupo do time"; siga.
10. Avise o dono, em poucas linhas, quais tarefas foram criadas e quando espera juntar tudo.

## Cuidados

- Uma tarefa por assistente e por entrega. Tarefa grande demais volta cheia de erro.
- Não passe senha, token nem dado de cliente na descrição da tarefa.
- Não crie tarefa que gaste verba, publique ou envie mensagem sem deixar claro que precisa de aprovação do dono.
- Desconto, verba nova, exceção e reclamação séria não viram tarefa de assistente. Vão para o dono.
- Não invente prazo, número ou promessa. Se faltar informação, pergunte.

## Como conferir antes de entregar

- Cada parte do pedido tem uma tarefa e um responsável.
- O `assignee` de cada tarefa é exatamente um destes nomes: ulisses, renata, marina, lara, breno, vitor, isabela.
- A ordem das dependências está escrita nas tarefas.
- Nenhuma tarefa manda algo para o ar sem aprovação.
- A mensagem ao dono diz o que foi criado, em quantas tarefas e quando ele vai ver o primeiro resultado.
