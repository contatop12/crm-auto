# Conversões do Meta pelo CRM (fusão com o whatsapp-track)

Data: 22/09/2026 · Branch: `feat/meta-capi`

## Objetivo

O CRM passa a devolver para a Meta Ads as conversões dos leads que vieram da
Meta, do mesmo jeito que já devolve para o Google Ads as dos leads do Google.

Quem dispara é o **funil do CRM**: os gatilhos e as etapas que já estão
configurados. No painel, cada etapa do Kanban ganha "qual evento da Meta dispara
aqui". Do whatsapp-track vem o que ele já resolve e está provado em produção:
captura do `ctwa_clid` pelo webhook da Evolution, credencial da Meta por
cliente (cifrada), montagem do payload da Conversions API e envio.

Ao fim, o whatsapp-track é desligado. Fica uma ferramenta só.

## Situação de partida (medida em 21-22/09)

- whatsapp-track em produção tem **1 cliente**, a Dra. Tainã: envio ligado,
  Página Meta, 705 contatos, 57 com `ctwa_clid`. A única regra é
  `LeadSubmitted` na 1ª mensagem vinda de anúncio. Foram 30 enviados entre
  13/08 e 19/09 e nenhum Purchase.
- O CRM hoje **descarta** a conversão de lead Meta: `ehDoMeta` em
  `stageChanged.ts` impede que ela suba para o Google. A Persianas tem 15
  conversões ignoradas por isso.
- O CRM não recebe a Evolution; recebe só o Chatwoot, que perde o `ctwa_clid`.
  Resultado: a Tainã tem `rastrear_meta_mensagem = 1` e **0** leads CTWA no
  CRM, contra 57 no tracker.
- Das instâncias Evolution, só a *Tainã Aci* tem webhook, e ele aponta para o
  tracker. A Evolution aceita **um** webhook por instância.
- Os dois Workers estão na mesma conta Cloudflare (Contato P12).
- Por enquanto **só a Tainã** roda campanha de mensagem na Meta. Todo lead
  dessa campanha chega com o texto pronto
  `Olá! Gostaria de mais informações [Protocolo: MA21RMKT]`. Hoje esse texto
  não vira lead em nada:
  - `findProtocol` exige hífen (`PREFIXO-CODIGO`), e `MA21RMKT` não tem;
  - a frase de entrada cadastrada da Tainã é outra ("Olá! Vi o anúncio e
    gostaria de agendar uma consulta.").

## Escopo

**Dentro (fase 1)**

- Canal de entrada `evolution` com chave própria, usado só para capturar o
  cartão do anúncio (`ctwa_clid`).
- Lead CTWA criado no CRM a partir do `ctwa_clid`, seguindo o caminho de
  sempre: etiqueta, promoção ao funil de Ads, conversão de entrada.
- Evento Meta por etapa do funil, com dois eventos possíveis: `LeadSubmitted`
  e `Purchase`.
- Envio pela CAPI em dois canais:
  - `whatsapp` (`business_messaging`) para lead com `ctwa_clid`;
  - `site` (`website`) para lead com `fbc` e sem `gclid`.
- Credencial Meta por cliente no painel, verificação de token, dry-run, código
  de teste, log de envio e reenvio de falhas.
- Botão "Conectar na Evolution".
- Importação da Tainã e virada.

**Fora**

- Formulário nativo da Meta (Lead Ads). Continua ignorado, com motivo
  registrado. A decisão foi não incluir agora; se entrar depois, é um terceiro
  canal (`system_generated` com `lead_id`, que já está no protocolo
  `PREFIXO-META-<leadgen_id>`).
- `QualifiedLead` e os demais eventos da Meta.
- Regras por palavra-chave do tracker, registro de "1ª mensagem" e as telas do
  tracker (transcrição, nota de IA, playbook, escuta ao vivo, testador de
  regra). Telas que fizerem falta voltam na **fase 2**, com spec própria.
- Portfólio da Meta (escolher dataset e Página numa lista em vez de digitar).
- Espelho das conversões Meta na aba `Conversoes` da planilha.

## Fluxo

```
Evolution (instância do cliente)
  └─ POST /ingest/:slug/evolution?k=…        chave do canal 'evolution'
       lê o corpo na borda — sem cartão de anúncio: 200 e nada gravado
       com ctwa_clid: INSERT OR IGNORE meta_atribuicoes

Chatwoot → fila → consumidor (já existe)
  message_incoming → atribuirLead
     1) protocolo na mensagem
     2) anúncio da Meta:  cartão no texto (hoje)  OU  ctwa_clid da Evolution
        para este telefone nos últimos 7 dias (novo)
        → lead PREFIXO-CTWA-<conversa>, leads.ctwa_clid preenchido
     3) telefone na janela
     4) frase de entrada (hoje) — a Tainã ganha a frase "MA21RMKT" → meta
        → lead TAINA-MSG-<conversa>
     lead de plataforma meta sem ctwa_clid → procura em meta_atribuicoes pelo
        telefone (7 dias) e grava em leads.ctwa_clid (novo)
     lead meta ainda sem clid, 1ª tentativa → adiar (20 s) — o clid pode ainda
        não ter chegado
     promove → dispararConversaoDeEntrada(plataforma)

Kanban (frase do vendedor move o card) → enviarConversao
  etapa → protocolo → lead → plataforma do lead
     google (gclid/gbraid/wbraid, ou nada de Meta) → Data Manager, igual a hoje
     meta:  ctwa_clid → canal whatsapp
            fbc      → canal site
            formulário Meta → ignorado ("formulário Meta não envia para a Meta")
       etapa sem meta_evento → ignorado com motivo
       INSERT OR IGNORE meta_eventos 'pendente' → QUEUE {source: 'meta_capi'}

fila 'meta_capi' → payload → Graph /{dataset}/events → grava resultado
```

Cada envio para a Meta é uma execução própria da fila. A conversão do Google já
gasta cerca de 15 subrequests por execução (ver comentário do `max_batch_size`
no `wrangler.jsonc`), e a Meta não pode disputar esse teto.

### Decisão de plataforma (função pura, `domain/`)

Na ordem:

1. Tem `gclid`, `gbraid` ou `wbraid` → `google`. É a mesma precedência do
   `ehDoMeta` atual: o clique do Google é mais forte que um cookie de pixel.
2. Tem `ctwa_clid` → `meta/whatsapp`.
3. `evento = 'meta_lead_form'` → `meta/formulario`, que é ignorado.
4. Tem `fbc` → `meta/site`.
5. Tem `utm_source` de Meta mas nenhum identificador (frase `MA21RMKT` ou
   cartão no texto, e o `ctwa_clid` nunca chegou) → `meta/sem_identificador`,
   ignorado com motivo.
   A CAPI de `business_messaging` exige o `ctwa_clid`.
6. Caso contrário → `google`, que é o caminho de hoje: sem conta ou sem
   identificador, o próprio Google recusa.

### Corrida Evolution × Chatwoot

A Evolution avisa o CRM direto. O Chatwoot só avisa depois de gravar a
mensagem, então na prática o clid chega antes. Há duas proteções para quando
ele não chegou:

1. **Na atribuição.** Um lead de campanha de mensagem da Meta (frase de
   entrada com plataforma `meta`, como a `MA21RMKT`, ou cartão no texto) que
   ainda está sem `ctwa_clid` faz o `atribuirLead` devolver `adiar`
   **uma vez**. O lead do site com `fbc` não espera, porque o identificador
   dele é o `fbc`. A fila já tem esse mecanismo
   (`ESPERA_ADIADA_S = 20`). Mensagem orgânica nunca espera. Na segunda
   tentativa, o fluxo segue com o que houver.
2. **No envio.** Um lead Meta sem `ctwa_clid` procura de novo em
   `meta_atribuicoes` pelo telefone antes de montar o evento, e grava o clid
   se achar. Cobre o clid que chegou depois da atribuição, para as etapas
   seguintes (Purchase).

### Etapa de entrada

Hoje `dispararConversaoDeEntrada` escolhe a primeira etapa com conversão do
Google. Passa a receber a plataforma:

- lead `google` → primeira etapa com `conversion_event` e
  `conversion_action_id` (igual a hoje);
- lead `meta` → primeira etapa com `meta_evento`.

## Dados — migração `0029_meta_capi.sql`

```sql
-- credencial e comportamento por cliente
ALTER TABLE tenant_config ADD COLUMN meta_dataset_id TEXT;
ALTER TABLE tenant_config ADD COLUMN meta_page_id TEXT;
ALTER TABLE tenant_config ADD COLUMN meta_waba_id TEXT;
ALTER TABLE tenant_config ADD COLUMN meta_test_event_code TEXT;
ALTER TABLE tenant_config ADD COLUMN meta_token_cipher TEXT;
ALTER TABLE tenant_config ADD COLUMN meta_token_iv TEXT;
ALTER TABLE tenant_config ADD COLUMN meta_token_last4 TEXT;
ALTER TABLE tenant_config ADD COLUMN meta_token_valido INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_config ADD COLUMN meta_token_conferido_em TEXT;
-- cliente novo nao envia: ligar e' decisao explicita (regra do tracker)
ALTER TABLE tenant_config ADD COLUMN meta_dry_run INTEGER NOT NULL DEFAULT 1;

-- evento Meta da etapa; NULL = etapa nao manda nada para a Meta
ALTER TABLE funnel_stages ADD COLUMN meta_evento TEXT
  CHECK (meta_evento IN ('LeadSubmitted', 'Purchase'));

ALTER TABLE leads ADD COLUMN ctwa_clid TEXT;

-- Taina: todo lead da campanha de mensagem da Meta chega com
-- "Ola! Gostaria de mais informacoes [Protocolo: MA21RMKT]". A frase casa por
-- "contem" depois do `limpa` (que preserva o codigo); findProtocol nao le
-- MA21RMKT porque exige hifen.
INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma)
SELECT id, 'MA21RMKT', 'mensagem', 'meta' FROM tenants WHERE slug = 'taina';

-- ingest_keys reconstruida: o CHECK de `canal` passa a aceitar 'evolution'
-- (tabela pequena; copia as linhas, mesmos indices)

CREATE TABLE meta_atribuicoes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_key      TEXT    NOT NULL,
  phone_e164     TEXT,
  ctwa_clid      TEXT    NOT NULL,
  ad_id          TEXT,
  source_url     TEXT,
  titulo         TEXT,
  evo_instancia  TEXT,
  origem         TEXT    NOT NULL DEFAULT 'evolution',  -- 'evolution' | 'tracker'
  recebido_em    TEXT    NOT NULL,
  UNIQUE (tenant_id, ctwa_clid)
);
CREATE INDEX idx_meta_atrib_fone ON meta_atribuicoes(tenant_id, phone_key, recebido_em DESC);

-- webhook que a instancia tinha antes do "Conectar": e' o que o "Restaurar
-- anterior" devolve. Guarda a URL inteira (pode ter o segredo de outro
-- sistema); a API so' expoe o host.
CREATE TABLE evo_webhooks_anteriores (
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evo_instancia  TEXT    NOT NULL,
  config         TEXT    NOT NULL,   -- json do /webhook/find: url, events, enabled, byEvents, base64
  salvo_em       TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, evo_instancia)
);

CREATE TABLE meta_eventos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dedupe_key       TEXT    NOT NULL,  -- protocolo-evento; no importado, o event_id do tracker
  event_id         TEXT    NOT NULL,  -- vai para a Meta; ela deduplica por ele
  protocol         TEXT,              -- NULL no importado do tracker
  phone_key        TEXT,
  canal            TEXT    NOT NULL CHECK (canal IN ('whatsapp', 'site')),
  event_name       TEXT    NOT NULL CHECK (event_name IN ('LeadSubmitted', 'Purchase')),
  etapa            TEXT,
  value            REAL,
  currency         TEXT,
  status           TEXT    NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente', 'nao_enviado', 'enviado', 'falhou')),
  http_code        INTEGER,
  tentativas       INTEGER NOT NULL DEFAULT 0,
  erro             TEXT,
  request_payload  TEXT,   -- so' hash + clid/fbc/ip/ua; expurgado com 30 dias
  response_body    TEXT,
  origem           TEXT    NOT NULL DEFAULT 'crm' CHECK (origem IN ('crm', 'tracker')),
  event_at         TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  sent_at          TEXT,
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX idx_meta_eventos_tenant ON meta_eventos(tenant_id, created_at DESC);
CREATE INDEX idx_meta_eventos_fone ON meta_eventos(tenant_id, phone_key, event_name);
```

- **`dedupe_key`** = `protocolo-LeadSubmitted` / `protocolo-Purchase`, no
  mesmo formato do `conversions.dedupe_key` do Google. O `event_id` enviado à
  Meta é igual à chave.
- **Trava contra o tracker:** antes de criar um evento, conferir se existe
  linha `origem = 'tracker'` com o mesmo `tenant_id`, `phone_key` e
  `event_name`. Se existir, o evento é ignorado com motivo ("já enviado pelo
  tracker"). Sem isso, o mesmo lead da Tainã chegaria duas vezes à Meta com
  `event_id` diferente.
- **Retentativa como a do Google:** `falhou` e `pendente` podem ser
  reenviados; `enviado` não. A exceção é `nao_enviado` (dry-run): ao ligar o
  envio, ele passa a valer, na mesma lógica do "ensaio não conta como envio"
  do `stageChanged`.
- **Cifra:** AES-GCM portado de `whatsapp-track/src/lib/crypto.ts`. O secret
  `MASTER_KEY` do CRM é **a mesma** do tracker, para o token da Tainã ser
  copiado ainda cifrado. A API nunca devolve o token; devolve só `last4`.
- **Expurgo:** `expurgarPayloadsAntigos` também anula `request_payload` e
  `response_body` de `meta_eventos` com mais de 30 dias. Esses campos têm IP e
  user agent em claro no canal site.

## Envio

Um módulo puro em `domain/` monta o corpo e um cliente em `clients/` faz o POST
em `https://graph.facebook.com/{versão}/{dataset}/events`. A versão fica numa
constante única. O tracker usa `v21.0`, que ainda era aceita em 19/09
(versões vencidas são promovidas pela Meta); a versão atual é conferida no
changelog na implementação.

**Canal whatsapp**

```json
{
  "event_name": "LeadSubmitted | Purchase",
  "event_time": "<step_changed_at em segundos>",
  "event_id": "<dedupe_key>",
  "action_source": "business_messaging",
  "messaging_channel": "whatsapp",
  "user_data": {
    "ph": ["<sha256>"],
    "ctwa_clid": "…",
    "page_id": "…",
    "whatsapp_business_account_id": "…"
  },
  "custom_data": { "value": 0, "currency": "BRL" }
}
```

- `page_id` e `whatsapp_business_account_id` entram quando existem. Sem os
  dois, o evento é `falhou` **antes da rede** (a Meta responderia o subcode
  2804116).
- O evento pixel `Lead` é recusado em `business_messaging` (subcode 2804066);
  por isso o nome é `LeadSubmitted`.

**Canal site**

- `action_source: "website"` e `event_source_url` = `leads.page_url`.
- `user_data`: `ph` e `em` (hash), `fbc`, `fbp`, `client_ip_address` e
  `client_user_agent` (os dois últimos em claro, como a Meta exige).
- `LeadSubmitted` sai como `Lead`, que é o nome padrão no site. `Purchase`
  fica igual.

**Nos dois canais**

- **Telefone:** só dígitos, com DDI e sem `+`, depois SHA-256 minúsculo.
  E-mail: `normEmail` e depois o hash.
- **Valor:**
  - `Purchase` usa `valorDaConversao(conversion_value, valor do card,
    valor_proposta)`. Sem valor real, é segurado com erro de cadastro,
    igual ao Google.
  - `LeadSubmitted` usa o `conversion_value` da etapa, ou sai sem valor.
- **`meta_dry_run = 1`:** monta, grava `nao_enviado` com o payload e não chama
  a Meta.
- **`meta_test_event_code`:** vai no corpo como `test_event_code`. O evento
  aparece em "Testar eventos" e não conta como conversão.
- **Resposta:**
  - HTTP 200 com `events_received ≥ 1` → `enviado`. Também marca
    `meta_token_valido = 1`.
  - HTTP 4xx → `falhou` definitivo, com a mensagem da Meta em `erro`. A fila
    não retenta e a falha vai para a central de notificações.
  - HTTP 5xx ou erro de rede → exceção, e a fila retenta (backoff, 5×,
    depois DLQ).
  - Evento com mais de 7 dias é recusado pela Meta e fica `falhou` com esse
    motivo.
- **Verificação de token:** port de `verificarTokenDoCliente`. Primeiro tenta
  `GET /{dataset}`. Se o token for de CAPI e não puder ler (code
  100/200/10), prova com um POST de teste `P12VERIFY`, que só aparece em
  "Testar eventos".

## Painel e API

**Aba nova "Meta Ads"** no perfil do cliente, ao lado de "Google Ads":

1. **WhatsApp (Evolution): conectar em um clique.** Fica em primeiro lugar
   na aba, porque sem ele não chega `ctwa_clid`.
   - **Lista as instâncias do cliente** (`inbox_instances` ativas +
     `tenant_config.evo_instancia`). Cada linha mostra:
     - se o WhatsApp está conectado (`connectionState`);
     - o webhook de hoje: **"conectado ao CRM"**, **"aponta para
       `host`"** (só o host, nunca a URL com segredo) ou **"sem webhook"**;
     - o último cartão de anúncio recebido (`MAX(recebido_em)` em
       `meta_atribuicoes` da instância), que é a prova ao vivo de que está
       chegando.
   - **Botão "Conectar"**, e tudo acontece do lado do servidor:
     1. garante a chave do canal `evolution` (cria se não existir; a pessoa
        não precisa revelar nem copiar nada);
     2. monta `https://<host do CRM>/ingest/<slug>/evolution?k=<chave>`;
     3. lê o webhook atual (`GET /webhook/find/{instância}`). Se ele aponta
        para outro lugar e o pedido não veio com `confirmar`, responde 409
        com o host atual. O painel pergunta "Hoje aponta para
        whatsapptrack.sitespdoze.com.br — substituir?" e repete com
        `confirmar`;
     4. guarda o webhook anterior em `evo_webhooks_anteriores`;
     5. grava com `POST /webhook/set/{instância}`:
        `{ webhook: { enabled: true, url, events: ["MESSAGES_UPSERT"], byEvents: false, base64: false } }`.
        `base64: false` impede que mídia venha embutida no corpo;
     6. relê o `find` e só responde "conectado" se a URL gravada for a do
        CRM.
   - **Botão "Restaurar anterior"** (aparece quando há anterior guardado):
     devolve o webhook que estava antes, com URL e eventos de antes. É a
     volta atrás da virada, em um clique.
2. **Conexão**
   - Campos: dataset, Página, WABA, token (só escrita; mostra `••••1234`) e
     código de teste.
   - "Verificar token", que mostra o nome do dataset.
   - Interruptor "Envio ligado" (`meta_dry_run`), no padrão do `sw-envio` do
     Google.
3. **Eventos por etapa:** as etapas do funil, cada uma com um seletor
   (nenhum / `LeadSubmitted` / `Purchase`). A etapa `Purchase` mostra
   "valor real da venda".
4. **Eventos enviados à Meta**
   - Log com data, protocolo, telefone mascarado, canal, evento, valor e
     status; ao expandir, a resposta da Meta.
   - "Reenviar falhas".

**Aba "Webhooks" → "Endereços de entrada"**

- Ganha o endereço da Evolution, com a chave do canal `evolution` (revelar e
  gerar, como os outros), para quem quiser configurar à mão.
- Gerar uma chave nova para `evolution` desconecta as instâncias já ligadas.
  O painel avisa e oferece "Conectar" de novo.

**Rotas**

```
GET    /api/tenants/:id/meta                    config, sem cifra
PUT    /api/tenants/:id/meta                    ids, código de teste, dry-run, token (opcional; cifrado na hora)
POST   /api/tenants/:id/meta/verificar
PUT    /api/tenants/:id/meta/etapas             { cw_step_id: meta_evento | null }
GET    /api/tenants/:id/meta/eventos            paginado
POST   /api/tenants/:id/meta/eventos/reenviar
GET    /api/tenants/:id/evolution/webhook       estado por instância (conexão, host do webhook, último cartão)
POST   /api/tenants/:id/evolution/webhook       { instancia, confirmar? } → conecta; 409 se aponta para outro lugar
POST   /api/tenants/:id/evolution/webhook/restaurar   { instancia } → devolve o webhook anterior
POST   /ingest/:slug/evolution?k=               público; chave do canal
```

A rota da Evolution segue a regra do caminho quente do `ingest.ts`: verificar,
gravar e responder, sem nenhuma chamada externa. Chave errada → 401, como as
outras rotas. Corpo acima de 1 MB → descartado. Só `messages.upsert`, fora de
grupo (`@g.us`), fora de status (`@broadcast`) e com `fromMe = false` passa
pelo leitor. O `jpegThumbnail` do cartão nunca é gravado.

## Arquivos (previstos)

| arquivo | o quê |
|---|---|
| `migrations/0029_meta_capi.sql` | schema acima |
| `src/domain/segredoMeta.ts` | cifra AES-GCM (port do tracker) |
| `src/domain/referralEvolution.ts` | lê o cartão de anúncio do corpo da Evolution (port de `parseEvolutionBody`, só a parte do anúncio) |
| `src/domain/plataformaLead.ts` | decisão google / meta-whatsapp / meta-site / ignorado |
| `src/domain/eventoMeta.ts` | monta o corpo CAPI por canal; nome do evento; hash |
| `src/clients/metaCapi.ts` | POST de eventos e verificação de token |
| `src/pipelines/metaCapi.ts` | consumidor `meta_capi`: envia, grava, notifica |
| `src/pipelines/stageChanged.ts` | bifurca por plataforma; ramo Meta cria `meta_eventos` e enfileira |
| `src/pipelines/leadMessage.ts` | fonte `ctwa_clid` da Evolution; `adiar`; plataforma na conversão de entrada |
| `src/routes/ingest.ts` | `POST /:slug/evolution`; canal `evolution` em `chaveDoCanal` |
| `src/routes/admin.ts` | rotas `/meta` e `/evolution/webhook` |
| `src/queue/consumer.ts`, `src/env.ts` | `source: 'meta_capi'`; `MASTER_KEY` |
| `src/db/observability.ts` | expurgo de `meta_eventos` |
| `panel/index.html` | aba Meta Ads; endereço e botão da Evolution |
| `scripts/importar-tracker.mjs` | importação única da Tainã (não versiona dado) |

## Virada da Tainã

1. **Deploy do CRM com a migração.** Nada muda para os 5 clientes: sem
   dataset, nenhum evento é criado.
2. **`wrangler secret put MASTER_KEY`** com o valor do tracker, guardado em
   `MASTER_KEY_PROD` no `.env`.
3. **`scripts/importar-tracker.mjs`**, rodado uma vez. Lê o D1
   `p12-whatsapp-track` pela API e grava no `crm_auto`:
   - config do cliente 1 no tenant `taina`: dataset, token cifrado, IV,
     `last4`, Página, `meta_token_valido`, com `meta_dry_run` ainda `1`;
   - atribuições com `ctwa_clid` em `meta_atribuicoes` (`origem = 'tracker'`);
   - os 30 envios em `meta_eventos` (`origem = 'tracker'`, `event_id`
     original, `phone_key`).
   - Nada disso vai para o git.
4. **Configurar as etapas no painel:** "Novo Lead" → `LeadSubmitted`,
   "Oportunidade Ganha" → `Purchase`. A frase `MA21RMKT` já entra pela
   migração.
5. **"Verificar token"** deve responder OK.
6. **Ligar o envio** (`meta_dry_run = 0`), direto e sem código de teste. A
   Tainã gera ~0,8 lead/dia; uma janela de teste custaria um dia de leads
   contados como teste. Ligar **antes** de conectar a Evolution: evento criado
   em dry-run fica `nao_enviado` e só sobe se a etapa disparar de novo.
7. **"Conectar na Evolution"** na instância *Tainã Aci*. A partir daqui o
   tracker para de receber e o CRM passa a enviar. O primeiro envio real é
   conferido no log (`events_received: 1`).
8. **Volta atrás:** "Restaurar anterior" na instância *Tainã Aci*, que
   devolve o webhook do tracker exatamente como estava (URL e eventos). O
   tracker fica no ar, intocado, por 14 dias. Desligá-lo depois disso é uma decisão
   separada.

Resultado esperado: a regra atual do tracker (`LeadSubmitted` na 1ª mensagem
de anúncio) é substituída por "Novo Lead" → `LeadSubmitted`, que dispara no
mesmo momento, quando a 1ª mensagem de anúncio é atribuída e o lead é
promovido. Como ganho, a Tainã passa a ter lead CTWA no CRM (etiqueta, card no
funil de Ads, planilha Meta) e `Purchase` quando o card for para Ganha.

## Testes

Vitest, seguindo `test/domain` e `test/pipelines`, com `test/helpers/fakeD1.ts`.

**Domínio**

- `referralEvolution`:
  - corpo no formato real, com `externalAdReply.ctwaClid`, `sourceUrl`,
    `title` e `contextInfo` nos três lugares onde o tracker procura;
  - grupo, status, `fromMe`, sem cartão e JSON inválido → `null`;
  - a miniatura não entra no resultado.
- `plataformaLead`: as seis regras da decisão, inclusive "gclid vence fbc" e
  "formulário é ignorado".
- `eventoMeta`:
  - hash do telefone e do e-mail;
  - corpo dos dois canais;
  - `LeadSubmitted` → `Lead` no site;
  - sem Página e sem WABA → erro;
  - `test_event_code` presente só quando configurado.
- `segredoMeta`: ida e volta; cifra adulterada lança erro (port do teste do
  tracker).

**Pipelines**

- `stageChanged`:
  - lead Meta com evento na etapa → linha em `meta_eventos` + mensagem na
    fila;
  - lead Google **exatamente** como hoje (os testes atuais continuam
    passando);
  - formulário Meta ignorado;
  - etapa sem `meta_evento` ignorada;
  - Purchase sem valor segurado;
  - dedup;
  - trava contra os envios `origem = 'tracker'`.
- `leadMessage`:
  - `Olá! Gostaria de mais informações [Protocolo: MA21RMKT]` com clid na
    Evolution → lead `TAINA-MSG-<conversa>` com `ctwa_clid`, promovido,
    conversão de entrada pela etapa Meta;
  - a mesma mensagem sem clid na 1ª tentativa → `adiar`; na 2ª segue sem clid;
  - clid da Evolution sem a frase → lead CTWA com `ctwa_clid`;
  - mensagem orgânica nunca adia.
- `stageChanged`: lead Meta sem `ctwa_clid` e com atribuição que chegou
  depois → o clid é achado no envio e vai no evento.
- `ingest` evolution: chave errada → 401; sem cartão → nada gravado; com
  cartão → `meta_atribuicoes`; reenvio do mesmo clid → uma linha só.
- `metaCapi` (consumidor): dry-run → `nao_enviado` sem `fetch`; 200 →
  `enviado`; 4xx → `falhou` sem retentar; 5xx → retenta.
- Conectar na Evolution (com `fetch` falso):
  - sem webhook → cria a chave se faltar e grava URL, eventos e
    `base64: false`;
  - webhook apontando para outro host, sem `confirmar` → 409 com o host, sem
    gravar nada;
  - com `confirmar` → guarda o anterior e grava;
  - o `find` depois do `set` com outra URL → responde erro, não "conectado";
  - "Restaurar anterior" → grava de volta a config guardada;
  - a resposta da API nunca contém a URL anterior inteira, só o host.

Antes de qualquer deploy: `npm test` e `npm run typecheck` verdes.

## Riscos

- **Webhook único na Evolution.** Conectar o CRM desliga o tracker. Por isso
  o botão exige confirmação e a volta atrás é uma chamada só.
- **Cartão sem `ctwa_clid`.** Se a Evolution entregar o cartão sem o clid em
  algum tipo de anúncio, o lead é criado, mas o evento sai "sem
  identificador" e não é enviado. Fica visível no log com motivo.
- **Versão da Graph API.** Fica numa constante; conferir no changelog na
  implementação.
- **Evento com mais de 7 dias.** A Meta recusa. Reenvio tardio de falha antiga
  não recupera.
