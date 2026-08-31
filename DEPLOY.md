# Deploy

**Status: publicado.** https://p12-crm-auto.contato-097.workers.dev

| Recurso | Valor |
|---|---|
| Worker | `p12-crm-auto` |
| D1 | `crm_auto` · `5fcf4193-f931-4b1a-9b67-bb5d758a1c5c` · 13 tabelas |
| KV | `CACHE` · `dae163f0067a4a648eb993095872c6dd` |
| Filas | `crm-auto-events` + `crm-auto-events-dlq` |
| Segredos | 13 cadastrados |

Verificado: `/health` responde `{"ok":true,"db":"ok"}`; `/api/*` devolve 401 sem
JWT do Access; ingestão com tenant inexistente devolve 404.

O passo a passo abaixo fica como referência para recriar o ambiente do zero ou
subir um segundo (staging).

Autenticação: o wrangler já está logado por OAuth como `contato@p12digital.com.br`
na conta `Contato P12` (`0976ee0adac0062c726747d29549308e`).

> ### O `CLOUDFLARE_API_TOKEN` do `.env` estava inválido
>
> `/user/tokens/verify` devolve 401. **O wrangler lê o `.env` do próprio
> projeto** e prefere esse token ao login OAuth — limpar a variável no shell não
> resolve. Cada chamada virava uma falha de autenticação, até a conta entrar em
> bloqueio temporário (`too many authentication failures`, código 10502).
>
> A linha já está comentada no `.env` (backup em `.env.bak-antes-do-comentario`).
> Para voltar a usar token: gere um novo em *My Profile → API Tokens*
> (template "Edit Cloudflare Workers") e descomente. Sem token, o OAuth assume.
>
> ### Use wrangler 4
>
> O wrangler 3.114 mascara erros da API: um **rate limit** (código 10429) na
> criação de fila aparece como `"The specified queue settings are invalid"`,
> o que manda você caçar o problema no lugar errado. A v4 mostra o erro real.

---

## 1. Criar os recursos

```bash
npx wrangler d1 create crm_auto
npx wrangler kv namespace create CACHE
npx wrangler queues create crm-auto-events
npx wrangler queues create crm-auto-events-dlq
```

Cada comando devolve um id. Copie para o `wrangler.jsonc`:

| Comando | Onde colar | Valor atual |
|---|---|---|
| `d1 create` | `d1_databases[0].database_id` | `5fcf4193-f931-4b1a-9b67-bb5d758a1c5c` ✅ criado |
| `kv namespace create` | `kv_namespaces[0].id` | `dae163f0067a4a648eb993095872c6dd` ✅ criado |
| filas | nada a colar — referenciadas por nome | ⏳ pendente (rate limit) |

Não dispare os `create` em sequência rápida: a API de filas limita por taxa e
o bloqueio dura minutos.

> Queues já está habilitado nesta conta (existe `publisher-article-jobs`), então
> não é questão de plano. Se ainda assim falhar, remova o bloco `queues` do
> `wrangler.jsonc` e chame `consumir()` direto da rota de ingestão com
> `ctx.waitUntil()` — funciona, mas perde retry e DLQ.

## 2. Aplicar as migrations

```bash
npx wrangler d1 migrations apply crm_auto --remote
```

Confira as 13 tabelas:

```bash
npx wrangler d1 execute crm_auto --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

## 3. Cadastrar os segredos

Nenhum destes vai para o `wrangler.jsonc` nem para o D1. Os valores estão no
`.env` local — **exceto `CHATWOOT_BASE_URL`, que deve ser
`https://chatwoot.sitespdoze.com.br`** (o `.env` tinha `chat.` e esse host não
resolve).

```bash
for s in CHATWOOT_BASE_URL CHATWOOT_API_TOKEN \
         GOOGLE_ADS_CLIENT_ID GOOGLE_ADS_CLIENT_SECRET GOOGLE_ADS_REFRESH_TOKEN \
         GOOGLE_ADS_DEVELOPER_TOKEN GOOGLE_ADS_MCC_ID \
         EVOLUTION_SERVER_URL EVOLUTION_API_KEY EVOLUTION_ALERT_INSTANCE EVOLUTION_ALERT_GROUP_ID \
         CF_ACCESS_TEAM_DOMAIN CF_ACCESS_AUD; do
  npx wrangler secret put "$s"
done
```

Mapeamento dos nomes do `.env` para os do Worker:

| `.env` | Worker |
|---|---|
| `CHATWOOT_DOMAIN` | `CHATWOOT_BASE_URL` |
| `CHATWOOT_TOKEN_ACCESS` | `CHATWOOT_API_TOKEN` |
| `EVOLUTION_INSTANCE` | `EVOLUTION_ALERT_INSTANCE` |
| `EVOLUTION_GROUP_ID` | `EVOLUTION_ALERT_GROUP_ID` |

## 4. Publicar

```bash
npx wrangler deploy
```

## 5. Conferir

```bash
curl https://p12-crm-auto.<subdominio>.workers.dev/health
# {"ok":true,"db":"ok","env":"development"}
```

`/health` é público de propósito e não expõe configuração de cliente. Todo o
resto do painel (`/api/*`) exige JWT do Cloudflare Access.

## 6. Cloudflare Access

Publicar o Worker **não** o protege sozinho. Crie a aplicação do Access
apontando para o domínio do painel (`ACCESS_APP_DOMAIN=dash.sitespdoze.com.br`)
com a política de e-mails de `ACCESS_ALLOWED_EMAILS`, e confirme que o `aud`
gerado bate com o `CF_ACCESS_AUD` cadastrado como segredo. Se não bater, o
middleware recusa todo mundo com 401 — é o comportamento correto.

---

## Ainda NÃO fazer

Nada de apontar o GTM nem de registrar os webhooks do Chatwoot para este Worker
ainda. Os cinco pipelines não estão implementados (Fase 3): os eventos são
gravados na tabela `events` e marcados como `ignorado`. Redirecionar o tráfego
agora faria os leads pararem de ser processados, porque o n8n deixaria de
recebê-los.

A ordem do plano continua valendo: implementar os pipelines → importar o
histórico das abas `Cliques` e `Conversoes` → shadow mode com
`validate_only = 1` → só então virar cliente a cliente.
