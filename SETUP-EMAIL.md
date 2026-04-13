# Fanin Boom - receber emails em @faninboom.store

## O que este projeto faz

| Recurso | Descricao |
|---------|-----------|
| **Site** | `https://faninboom.store/` |
| **Emails** | Gera enderecos `qualquer@faninboom.store` |
| **SMTP de entrada** | Recebe email real pela porta `25` quando o MX do dominio aponta para este servidor |
| **Webhook HTTP** | `POST /api/inbound/email` para encaminhadores e provedores externos |
| **Envio transacional** | `POST /api/outbound/send` usando Mailgun |
| **Inbox web** | Mostra mensagens, remetentes e codigos detectados automaticamente |

## Fluxo recomendado

1. Gere um endereco no painel principal.
2. Use esse email onde quiser.
3. Abra a inbox do endereco gerado.
4. O sistema salva a mensagem completa e destaca codigos quando encontrar.

## DNS e recebimento

- O dominio principal ativo e `faninboom.store`.
- O registro **MX** de `faninboom.store` precisa apontar para a maquina ou servico que vai receber os emails.
- O HTTP publico deve responder em `https://faninboom.store/`.
- Para SMTP real, a porta `25` precisa estar acessivel no firewall e no roteador.

## Como rodar

```bash
npm start
```

Por padrao:
- HTTP em `3000`
- SMTP em `25`
- Dominio fixo em `@faninboom.store`

Se quiser usar apenas API HTTP:

```bash
set ENABLE_SMTP_INBOUND=false
npm start
```

## Envio com Mailgun

Esse projeto agora pode enviar email transacional de forma legitima usando a API do Mailgun.

Defina estas variaveis antes de subir o servidor:

```bash
set MAILGUN_API_KEY=key-sua-chave
set MAILGUN_DOMAIN=mg.seudominio.com
set MAILGUN_FROM=Seu Projeto <no-reply@mg.seudominio.com>
```

Endpoints:

- `GET /api/outbound/status`
- `POST /api/outbound/send`

Exemplo:

```json
{
  "to": "cliente@example.com",
  "subject": "Confirme seu cadastro",
  "text": "Seu codigo de confirmacao e 123456"
}
```

Observacoes:

- O dominio precisa estar verificado no Mailgun.
- `MAILGUN_FROM` precisa usar um remetente valido desse dominio.
- Esse fluxo e para envio de emails do seu sistema, nao para criacao de contas de email.

## Verificacao rapida

- `GET https://faninboom.store/api/health`
- O retorno deve conter `"domain":"faninboom.store"`
- Os headers devem mostrar:
  - `X-Email-Domain: faninboom.store`
  - `X-API-Build: faninboom-v7-pro`

## Exemplo de webhook

`POST https://faninboom.store/api/inbound/email`

```json
{
  "to": "usuario@faninboom.store",
  "from": "noreply@example.com",
  "subject": "Seu codigo",
  "text": "Seu codigo de verificacao e 123456"
}
```

## Opcao sem abrir porta (Cloudflare Email Routing + Worker)

Se voce nao consegue abrir/usar a porta 25, use:

Email -> Cloudflare Email Routing / Worker -> seu painel

Endpoint do painel:
- `POST https://faninboom.store/api/inbound/gmail`

O Worker pode mandar:
- `raw` + `encoding`
- ou payload direto com `to`, `from`, `subject`, `text`

## Arquivo de apoio

No projeto existe um modelo pronto para Cloudflare Worker:

- `cloudflare-email-worker.mjs`

Ele encaminha qualquer email recebido para o painel.
