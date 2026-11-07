# Painel do Frank

Painel de voz do Frank. Você fala com o Frank pelo navegador, a legenda acompanha a conversa, o time de 8 agentes aparece na tela e o trabalho vai para o perfil frank do Hermes. A voz é do Gemini Live; o cérebro é o Hermes. Os cartões do time e as entregas para aprovar seguem o quadro Kanban do Hermes.

Precisa do Node 22.23.3 ou mais novo. Não tem dependência npm.

## Variáveis de ambiente

O painel lê o arquivo `.env` da pasta dele. Se a mesma variável estiver no ambiente do processo, vale a do ambiente.

| Variável | Obrigatória | Para que serve |
|---|---|---|
| `GEMINI_API_KEY` | sim | Chave do Google AI Studio. Liga a voz do Frank. |
| `HERMES_API_URL` | sim | Endereço da API do perfil frank no Hermes, por exemplo `http://127.0.0.1:8642/p/frank`. |
| `HERMES_API_KEY` | sim | Chave da API do Hermes. |
| `HERMES_BIN` | não | Caminho da CLI do Hermes, que o painel usa para ler o quadro Kanban. Sob o systemd, use `/home/hermes/.local/bin/hermes`. Sem ela, o painel tenta `~/.local/bin/hermes` e depois `hermes` no PATH. |
| `HERMES_HOME` | não | Pasta do Hermes, só se não for a padrão (`~/.hermes`). O painel repassa à CLI e procura o `kanban.db` nela. |
| `FRANK_NOME_DO_DONO` | não | Nome com que o Frank chama o dono (até 40 letras). Sem ela, a saudação e as instruções ficam neutras. |
| `FRANK_NOME_DA_EMPRESA` | não | Nome da empresa (até 60 caracteres). Entra nas instruções do Frank e no título da aba. |
| `FRANK_VOZ` | não | Voz do Frank: Puck (padrão), Achird, Umbriel, Zubenelgenubi, Sadachbia, Charon ou Orus. Fora da lista, vale Puck e o log avisa. |
| `FRANK_ACCESS_CODE` | não | Código que o painel pede antes de ligar o Frank. Vazia, o painel não pede código. |
| `FRANK_PORTA` | não | Porta do painel. Padrão: 8787. |
| `FRANK_HOST` | não | Endereço em que o painel escuta. Padrão: 127.0.0.1, que só aceita conexão da própria VPS. |
| `FRANK_PASTA_DE_DADOS` | não | Pasta onde ficam as demandas. Padrão: `data/` dentro do painel. |
| `OPENAI_API_KEY` | não | Liga o GPT Live como segunda voz. Sem ela, o painel nem mostra a troca de voz. |
| `FRANK_ORIGEM_PUBLICA` | não | Só para quem publica o painel atrás de um proxy HTTPS: o endereço público, como `https://frank.exemplo.com`. No túnel SSH, deixe vazia. |
| `FRANK_ENV_FILE` | não | Caminho de outro arquivo `.env`. Só vale no ambiente do processo. |

Exemplo de `.env` (troque os valores):

```
GEMINI_API_KEY=sua-chave-do-ai-studio
HERMES_API_URL=http://127.0.0.1:8642/p/frank
HERMES_API_KEY=sua-chave-do-hermes
HERMES_BIN=/home/hermes/.local/bin/hermes
FRANK_NOME_DO_DONO=Ana
FRANK_NOME_DA_EMPRESA=Doces da Ana
FRANK_VOZ=Puck
```

Proteja o arquivo: `chmod 600 .env`.

O painel usa estas rotas da API do Hermes: `/v1/runs`, `/v1/runs/{id}`, `/v1/runs/{id}/events`, `/v1/runs/{id}/approval`, `/api/model/options` e `/api/sessions/{id}/messages`.

## Quadro Kanban

O painel lê o quadro com `hermes kanban list --json` e, para o texto de uma entrega, `hermes kanban show <id> --json`. Ele roda como o mesmo usuário do Hermes e usa o `HOME` desse usuário (o systemd já define `HOME` quando a unidade tem `User=hermes`).

- Tarefa `running` de um assistente acende o cartão como trabalhando, com o título da tarefa.
- Tarefa `ready`, `todo` ou `scheduled` aparece como "na fila"; `blocked` aparece como "travado".
- Tarefa que chega a `review` ou `done` vira entrega em "Para aprovar", com o texto do resultado. Só entram as das últimas 12 horas.
- Aprovar, pedir ajuste ou descartar manda o turno ao Frank com o id da tarefa. O painel guarda a decisão em `quadro-decisoes.json`, na pasta de dados, e a entrega só volta se a tarefa entregar de novo.
- A delegação por `delegate_task` com o nome do assistente entre colchetes continua funcionando junto.

A CLI só roda enquanto houver navegador com o painel aberto e visível. Cada chamada custa cerca de 0,6 s de CPU; o painel pergunta a cada 5 s, mas só chama a CLI de novo quando o `kanban.db` mudou, e uma vez por minuto mesmo sem mudança. Sem a CLI ou sem o quadro, o painel segue como antes e o log avisa uma vez.

## Partida

Na pasta do painel:

```
node server.mjs
```

O log mostra `Painel do Frank no ar em http://127.0.0.1:8787` e uma linha com o estado do Gemini, do Hermes e do código de acesso.

## Serviço systemd

Arquivo `/etc/systemd/system/painel-do-frank.service`, com os caminhos que o instalador usa (painel em `/opt/time-do-frank/painel`, Node em `/opt/node/bin/node`).

```
[Unit]
Description=Painel de voz do Frank
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hermes
WorkingDirectory=/opt/time-do-frank/painel
ExecStart=/opt/node/bin/node server.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Para ligar e acompanhar:

```
sudo systemctl daemon-reload
sudo systemctl enable --now painel-do-frank
journalctl -u painel-do-frank -f
```

## Abrir pelo túnel SSH

No seu computador, abra um terminal e rode (troque o IP pelo da sua VPS):

```
ssh -N -L 8787:127.0.0.1:8787 hermes@IP_DA_VPS
```

Deixe essa janela aberta e abra `http://localhost:8787` no Chrome. O microfone funciona porque o navegador trata `localhost` como endereço seguro.

Use o mesmo número de porta dos dois lados do túnel. O painel só aceita o endereço `localhost` ou `127.0.0.1` com a porta em que ele escuta; com outra porta, a página responde "Host não autorizado". Se mudar `FRANK_PORTA`, mude os dois números do comando.
