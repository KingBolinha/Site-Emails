# Gerador de Emails

Painel web em Node.js para gerar caixas `@faninboom.store`, receber mensagens por webhook/Email Worker e consultar codigos recebidos.

## Requisitos

- Node.js
- Cloudflare Tunnel configurado no computador/servidor

## Instalar

```bat
npm install
```

## Iniciar o servidor

```bat
set INBOUND_API_KEY=SUA_CHAVE_FORTE
set ENABLE_SMTP_INBOUND=false
set DEBUG_INBOUND=true
node server.js
```

## Iniciar o tunnel

```bat
cloudflared --config "C:\Users\Administrator\.cloudflared\config.yml" tunnel run
```

## Rotas principais

- `GET /api/health`
- `POST /api/generate-email`
- `GET /api/latest-code?email=usuario@faninboom.store`
- `POST /api/inbound/worker`
- `POST /api/inbound/email`
- `POST /api/inbound/gmail`

## Observacoes

Arquivos locais como `mailboxes.json`, `config.yml`, `.env` e `node_modules/` nao devem ser enviados ao GitHub.
