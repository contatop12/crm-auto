# Deploy

**Status: publicado.** https://crm-auto.contato-097.workers.dev

| Recurso | Valor |
|---|---|
| Worker | `crm-auto` — deployado pelo Workers Builds a cada push em `main` |
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

> ### `wrangler secret bulk` SUBSTITUI o conjunto inteiro
>
> Ele nao faz merge. Rodar `secret bulk` com um arquivo de um campo so apaga
> todos os outros segredos. Foi o que derrubou Chatwoot, Google Ads e Evolution
> de uma vez, com o erro opaco `Cannot read properties of undefined (reading
> 'replace')`.
>
> Para mudar UM segredo: `npx wrangler secret put NOME`.
> Para usar `bulk`: o arquivo precisa conter o conjunto COMPLETO.
>
> Confira depois com `npx wrangler secret list` — sao 13.
> O `src/domain/config.ts` agora troca aquele erro opaco por
> "segredo X nao cadastrado", dizendo qual falta e como resolver.

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

## Configuracao do Access (feita)

Tres aplicativos, nesta forma:

| App | Destino | Politica |
|---|---|---|
| `crm-auto - Painel` | `crm.sitespdoze.com.br` | Allow · email_domain p12digital.com.br |
| `crm-auto - Webhooks (bypass)` | `crm.sitespdoze.com.br/ingest` e `/health` | **Bypass** · Everyone |

O caminho mais especifico vence, entao `/ingest` fica publico e o resto exige
login. `workers_dev` esta desligado: o dominio proprio e' a unica porta, e a
URL workers.dev seria uma segunda porta fora dessas regras.

**Nao use politica de Worker.** Existia um app `crm-auto - Cloudflare Workers`
com destino `{"type":"worker"}`: esse tipo cobre o Worker inteiro, em qualquer
hostname e qualquer caminho, e NAO aceita excecao de path. Enquanto ele existiu,
todo webhook recebia a tela de login. Foi removido.

Ao trocar de app, o `aud` muda e o `CF_ACCESS_AUD` precisa acompanhar, senao o
painel devolve 401 mesmo com login valido. Use `wrangler secret put`, nunca
`secret bulk`.

### O token da Cloudflare no .env e' account-owned

Comeca com `cfat_` e tem 53 caracteres. Ele **nao** valida em
`/user/tokens/verify` (devolve 401 e parece invalido); o endpoint certo e'
`/accounts/{id}/tokens/verify`. O wrangler tambem nao o aceita sozinho — por
isso os deploys usam o login OAuth (`CLOUDFLARE_API_TOKEN="" npx wrangler ...`).

## Access nao pode cobrir /ingest

Uma politica de **Worker / todo o trafego** cobre tambem as rotas de ingestao, e
`sendBeacon` do GTM e webhook do Chatwoot nao seguem redirect nem fazem login:
recebem a pagina do Access e o evento se perde.

Crie uma aplicacao de **hostname** com politica **Bypass / Everyone** para
`crm.sitespdoze.com.br` path `ingest` (e `health`, se quiser monitorar de fora).
Politica de hostname vence politica de Worker.

As rotas de ingestao se autenticam sozinhas: `ingest_key` no clique e assinatura
HMAC no webhook do Chatwoot.

## As chaves do Access vem do KV, nao de fetch

O Worker nao consegue buscar `https://<team>/cdn-cgi/access/certs`: a Cloudflare
intercepta `/cdn-cgi/*` e recusa a sub-requisicao com 403. Semeie de fora:

```bash
curl -s https://p12dash.cloudflareaccess.com/cdn-cgi/access/certs   | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);require("fs").writeFileSync("jwks.tmp.json",JSON.stringify(j.keys.map(k=>({kid:k.kid,kty:k.kty,n:k.n,e:k.e,alg:k.alg}))))})'
npx wrangler kv key put "jwks:access" --path ./jwks.tmp.json --binding CACHE --remote
rm jwks.tmp.json
```

Quando a Cloudflare rotacionar as chaves, `/api/me` passa a devolver
`modo: "claims"` com aviso — resemeie. O painel nao tranca ninguem para fora
nesse meio-tempo, porque o Access na borda ja barrou quem nao tem sessao.

## O nome do Worker precisa bater com o do Workers Builds

`wrangler.jsonc` usa `"name": "crm-auto"`, igual ao nome do projeto no Workers
Builds. Se divergirem, a CI avisa (`Failed to match Worker name`), sobrescreve
com o nome dela e sobe um **segundo** Worker. Os dois viram produtores da mesma
fila, e o `deploy` quebra em:

```
Queue 'crm-auto-events' already has a consumer. [code: 11004]
```

porque uma fila só aceita um consumidor. Para limpar, na ordem:

```bash
npx wrangler queues consumer worker remove crm-auto-events <worker-errado>
npx wrangler delete --name <worker-errado>
```

(O `delete` recusa enquanto o Worker for consumidor de alguma fila.)

## Ainda NÃO fazer

Nada de apontar o GTM nem de registrar os webhooks do Chatwoot para este Worker
ainda. Os cinco pipelines não estão implementados (Fase 3): os eventos são
gravados na tabela `events` e marcados como `ignorado`. Redirecionar o tráfego
agora faria os leads pararem de ser processados, porque o n8n deixaria de
recebê-los.

A ordem do plano continua valendo: implementar os pipelines → importar o
histórico das abas `Cliques` e `Conversoes` → shadow mode com
`validate_only = 1` → só então virar cliente a cliente.

## Regras de automação do Chatwoot, por cliente

Todas apontam para o painel. As legadas (`LeadsGoogle` / `Lead do Google`)
foram desativadas: promoviam por "tem protocolo", e o fluxo carimbava `ORG-<id>`
também no lead orgânico — foi assim que 12 orgânicos foram parar no funil de
Ads da Vita.

| Regra | Evento | Condição | Faz |
|---|---|---|---|
| `[PAINEL] Promover ao funil de Ads` | `conversation_updated` | `funil = PROMOVER` **e** `protocolo` presente | transfere para o funil e carimba `funil = Lead` |
| `[PAINEL] Lead novo no funil` | `kanban_task_updated` | board do funil **e** etapa de entrada | avisa `/ingest/<slug>/kanban` → aviso no grupo |
| `Evento Qualificado 1 / 2 / Compra` | `kanban_task_updated` | board do funil **e** etapa da meta | avisa `/ingest/<slug>/kanban?…&evento=conversao` |

O `&evento=conversao` é o que separa os dois propósitos do mesmo endereço.
Sem ele, a regra de "Evento Compra" faria o pipeline anunciar como **lead novo**
alguém que acabou de fechar a venda.

A regra de promoção existe porque a API do Chatwoot **não move card entre
boards** (ver `docs/api-reference.md`). Ela não decide nada — só executa o que o
painel gravou.

Ids em 03/09/2026:

```
vita       38 promover · 42 entrada · 23/24/25 conversão
persianas  44 promover · 40 entrada · 31/32/33/35 conversão
locadora   43 promover · 39 entrada · 19/20/21 conversão
taina      45 promover · 41 entrada · 10/11/12 conversão
```
