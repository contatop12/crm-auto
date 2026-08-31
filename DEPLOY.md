# Deploy

O Worker já compila (`npx wrangler deploy --dry-run` → 93 KiB / 23 KiB gzip).
Falta só criar os recursos na conta e preencher os três `"PREENCHER"` do
`wrangler.jsonc`.

Autenticação: o wrangler já está logado por OAuth como `contato@p12digital.com.br`
na conta `Contato P12` (`0976ee0adac0062c726747d29549308e`).

> **O `CLOUDFLARE_API_TOKEN` do `.env` está inválido** — `/user/tokens/verify`
> devolve 401. Não exporte essa variável no shell: se ela estiver setada, o
> wrangler a prefere ao OAuth e o deploy falha. Gere um token novo em
> *My Profile → API Tokens* (template "Edit Cloudflare Workers") ou apague a
> linha do `.env` e siga no OAuth.

---

## 1. Criar os recursos

```bash
npx wrangler d1 create crm_auto
npx wrangler kv namespace create CACHE
npx wrangler queues create crm-auto-events
npx wrangler queues create crm-auto-events-dlq
```

Cada comando devolve um id. Copie para o `wrangler.jsonc`:

| Comando | Onde colar |
|---|---|
| `d1 create` | `d1_databases[0].database_id` |
| `kv namespace create` | `kv_namespaces[0].id` |
| filas | nada a colar — são referenciadas por nome |

> Filas exigem plano **Workers Paid**. Sem ele, `queues create` falha. Nesse
> caso, remova o bloco `queues` do `wrangler.jsonc` e chame `consumir()` direto
> da rota de ingestão com `ctx.waitUntil()` — funciona, mas perde retry e DLQ.

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
