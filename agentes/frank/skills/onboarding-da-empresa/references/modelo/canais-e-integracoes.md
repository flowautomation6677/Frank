# Canais e integrações

> Como preencher: marque só o que está conectado DE VERDADE no servidor, testado. Quando um agente pedir uma integração que está como "não", ele trabalha em rascunho e diz "BLOQUEADO: falta <integração>". Atualize este arquivo toda vez que conectar ou desconectar algo.

| Integração | Conectada? | Quem usa | Variável ou configuração | Testado em |
|---|---|---|---|---|
| Telegram do dono com o Frank | {{SIM_NAO}} | Frank | gateway do Hermes | {{DATA}} |
| WhatsApp da empresa | {{SIM_NAO}} | Vitor, Frank | gateway do Hermes | {{DATA}} |
| Direct do Instagram | {{SIM_NAO}} | Vitor | {{CONFIG}} | {{DATA}} |
| Conta de anúncios da Meta (leitura) | {{SIM_NAO}} | Breno, Isabela | META_ACCESS_TOKEN, META_AD_ACCOUNT_ID | {{DATA}} |
| Conta de anúncios da Meta (alterar) | {{SIM_NAO}} | Breno, só com liberação | META_ACCESS_TOKEN com ads_management | {{DATA}} |
| Checkout e vendas | {{SIM_NAO}} | Isabela | {{PLATAFORMA}} | {{DATA}} |
| Agenda | {{SIM_NAO}} | Frank, Vitor | {{CONFIG}} | {{DATA}} |
| Zoom | {{SIM_NAO}} | Vitor | ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET ou ZOOM_LINK_FIXO | {{DATA}} |
| Hospedagem de páginas | {{SIM_NAO}} | Marina | {{CONFIG}} | {{DATA}} |
| Publicação no Instagram | {{SIM_NAO}} | Lara | {{CONFIG}} | {{DATA}} |
| API oficial do WhatsApp (disparo) | {{SIM_NAO}} | dono dispara; Renata escreve | {{CONFIG}} | {{DATA}} |
| Pagamento de contas | {{SIM_NAO}} | Frank, só com autorização | {{CONFIG}} | {{DATA}} |

## Onde ficam os arquivos que o dono manda

- Exportações (anúncios, vendas, extrato, grupos): {{PASTA}}
