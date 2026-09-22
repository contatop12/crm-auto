# Conversões da Meta pelo CRM — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** o CRM passa a devolver para a Meta Ads as conversões dos leads que vieram da Meta (campanha de mensagem com `ctwa_clid` e site com `fbc`), disparadas pelas etapas do funil, e o whatsapp-track é desligado.

**Arquitetura:** a Evolution manda as mensagens para uma rota nova do CRM, que guarda só o cartão do anúncio (`ctwa_clid`) em `meta_atribuicoes`. A atribuição do lead (Chatwoot → fila) usa esse clique para criar o lead da Meta. Quando o card entra numa etapa com evento da Meta, `enviarConversao` bifurca: lead do Google segue igual a hoje; lead da Meta grava `meta_eventos` e enfileira um envio próprio, que o consumidor manda à Conversions API.

**Stack:** Cloudflare Workers + Hono + D1 + Queues, TypeScript estrito, Vitest com `test/helpers/fakeD1.ts` (SQLite real em memória), painel em `panel/index.html` (HTML + JS puro).

**Spec:** `docs/superpowers/specs/2026-09-22-meta-capi-no-crm-design.md` — leia antes de começar. O plano argumenta a partir dela.

## Restrições globais

- Eventos da Meta: só `LeadSubmitted` e `Purchase`.
- Cliente novo nasce com `meta_dry_run = 1`: ligar o envio é decisão explícita.
- O token da Meta nunca sai pela API nem vai para log. A API devolve só `last4`.
- `MASTER_KEY` do CRM = a mesma do whatsapp-track (o token da Tainã é copiado ainda cifrado).
- Versão da Graph API numa constante só: `GRAPH_VERSAO = 'v26.0'` em `src/clients/metaCapi.ts` (conferida no changelog em 22/09/2026: v26.0, de 29/07/2026, é a mais recente).
- Rota `/ingest/:slug/evolution`: verificar, gravar e responder, sem chamada externa. Chave errada → 401. Corpo acima de 1 MB → descartado. O `jpegThumbnail` nunca é gravado.
- A resposta da API nunca contém a URL inteira de um webhook de outro sistema, só o host.
- Nenhum dado de cliente (telefone, token) vai para o git. O script de importação não grava arquivo.
- Comentários de código em português, no estilo do repositório (sem acento, `e'` para "é"). Texto de tela com acento.
- `npm test` e `npm run typecheck` verdes ao fim de cada tarefa.
- Git: trabalhe na branch `feat/meta-capi`. Um commit por tarefa, terminando com a linha `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. **Não rode `git push`**: o push é feito pelo usuário (push na `main` dispara o deploy).

### Decisões deste plano que ajustam a spec

1. **Fila:** a spec fala em `source: 'meta_capi'`. O plano usa `source: 'kanban'` com `eventType: 'meta_capi'` e uma linha em `events` por envio. Motivo: `events.source` tem `CHECK (source IN ('click','chatwoot','kanban','meta'))` e reconstruir `events` (a tabela mais movimentada) só por isso não vale; e, com a linha em `events`, a falha de envio aparece de graça no log de Atividade e na central de notificações. Continua sendo uma execução da fila por envio.
2. **Ordem da atribuição:** a spec lista o teste "`MA21RMKT` com clid na Evolution → lead `TAINA-MSG-<conversa>`", mas o fluxo da própria spec põe o clique da Evolution no passo 2, antes da frase. O plano segue o fluxo: com clique, o lead é `TAINA-CTWA-<conversa>` (com `ctwa_clid`); sem clique depois da espera, `TAINA-MSG-<conversa>`.
3. **Espera (`adiar`):** só acontece para cliente que tem chave do canal `evolution` (ou seja, que ligou a Evolution ao CRM). Sem isso o clique nunca viria e a espera só atrasaria o lead.
4. **Nenhum lead órfão:** a espera acontece antes de criar o lead da frase. Na 2ª tentativa, se o clique chegou, nasce só o lead do anúncio.

## Mapa de arquivos

| arquivo | responsabilidade | tarefa |
|---|---|---|
| `migrations/0029_meta_capi.sql` | schema da spec + `ingest_keys` com canal `evolution` | 1 |
| `src/domain/referralEvolution.ts` | lê o cartão do anúncio do corpo da Evolution | 2 |
| `src/routes/ingest.ts` | `POST /:slug/evolution`; canal `evolution` na chave e no ping | 3 |
| `src/domain/webhookEvolution.ts` | estado do webhook, URL do CRM, formato de volta | 4 |
| `src/clients/evolution.ts` | `webhook()` e `definirWebhook()` | 4 |
| `src/pipelines/webhookEvolution.ts` | listar, conectar e restaurar o webhook | 4 |
| `src/routes/metaAds.ts` | rotas `/evolution/webhook` e `/meta` (montadas em `admin`) | 5, 14 |
| `src/routes/admin.ts` | canal `evolution` nas chaves; monta `metaAds` | 5 |
| `src/routes/api.ts` | `ingest-status` da Evolution; `erro_em` da Meta | 5, 15 |
| `panel/index.html` | aba Meta Ads; endereço da Evolution | 6, 16 |
| `src/domain/segredoMeta.ts` | cifra AES-GCM do token (port do tracker) | 7 |
| `src/env.ts` | `MASTER_KEY` | 7 |
| `src/domain/plataformaLead.ts` | Google × Meta/whatsapp × Meta/site × fora | 8 |
| `src/domain/eventoMeta.ts` | corpo da CAPI por canal | 9 |
| `src/clients/metaCapi.ts` | POST de eventos e verificação do token | 10 |
| `src/pipelines/metaCapi.ts` | criar, enfileirar, enviar e reenviar eventos | 11, 12 |
| `src/queue/consumer.ts` | `meta_capi` e tentativa na atribuição | 11, 13 |
| `src/db/metaAtribuicoes.ts` | clique mais recente do telefone (7 dias) | 12 |
| `src/pipelines/stageChanged.ts` | bifurca Google × Meta | 12 |
| `src/pipelines/leadMessage.ts` | clique da Evolution, espera, etapa de entrada por plataforma | 13 |
| `src/pipelines/metaConfig.ts` | cadastro da Meta, etapas, log | 14 |
| `src/db/observability.ts` | expurgo de `meta_eventos` | 15 |
| `src/domain/notificacoes.ts` | notificação do envio que falhou | 15 |
| `src/domain/importTracker.ts`, `scripts/importar-tracker.mjs` | importação única da Tainã | 17 |

A **Parte A** (tarefas 1–6) já pode ir para produção sozinha: guarda o clique do anúncio e dá o botão "Conectar". A **Parte B** (7–16) é o motor de envio. A **Parte C** (17–18) é a virada da Tainã.

---

# Parte A — Captura do clique do anúncio

### Tarefa 1: Migração `0029_meta_capi.sql`

**Arquivos:**
- Criar: `migrations/0029_meta_capi.sql`
- Teste: `test/db/migracaoMetaCapi.test.ts`

**Interfaces:**
- Produz (schema): `tenant_config.meta_*`, `funnel_stages.meta_evento`, `leads.ctwa_clid`, tabelas `meta_atribuicoes`, `evo_webhooks_anteriores`, `meta_eventos`, `ingest_keys.canal` aceitando `'evolution'`, frase `MA21RMKT` da Tainã. Nomes exatos no SQL abaixo; todas as tarefas seguintes dependem deles.

- [ ] **Passo 1: escrever o teste que falha**

`test/db/migracaoMetaCapi.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fakeD1 } from '../helpers/fakeD1';

/** As migrations anteriores a 0029, para montar o banco como ele esta' em producao hoje. */
const ANTES = readdirSync('migrations')
  .filter((f) => f.endsWith('.sql') && f < '0029')
  .sort()
  .map((f) => `migrations/${f}`);

describe('migracao 0029 (Meta CAPI)', () => {
  test('ingest_keys passa a aceitar o canal evolution sem perder as chaves de hoje', () => {
    const { exec, consultar } = fakeD1(ANTES);
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    exec(`INSERT INTO ingest_keys (tenant_id, canal, chave, revelada) VALUES (5, 'click', 'k-click', 1)`);

    exec(readFileSync('migrations/0029_meta_capi.sql', 'utf8'));

    exec(`INSERT INTO ingest_keys (tenant_id, canal, chave) VALUES (5, 'evolution', 'k-evo')`);
    expect(consultar(`SELECT canal, chave FROM ingest_keys ORDER BY canal`)).toEqual([
      { canal: 'click', chave: 'k-click' },
      { canal: 'evolution', chave: 'k-evo' },
    ]);
    expect(() => exec(`INSERT INTO ingest_keys (tenant_id, canal, chave) VALUES (5, 'outro', 'x')`)).toThrow();
  });

  test('a Taina ganha a frase MA21RMKT da campanha de mensagem', () => {
    const { exec, consultar } = fakeD1(ANTES);
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    exec(readFileSync('migrations/0029_meta_capi.sql', 'utf8'));
    expect(consultar(`SELECT tenant_id, frase, origem, plataforma FROM lead_entry_phrases WHERE frase = 'MA21RMKT'`))
      .toEqual([{ tenant_id: 5, frase: 'MA21RMKT', origem: 'mensagem', plataforma: 'meta' }]);
  });

  test('etapa so aceita LeadSubmitted ou Purchase', () => {
    const { exec } = fakeD1();
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id, meta_evento) VALUES (5, 1, 'Novo Lead', 22, 'LeadSubmitted')`);
    expect(() =>
      exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id, meta_evento) VALUES (5, 2, 'X', 23, 'Lead')`),
    ).toThrow();
  });

  test('um clique (ctwa_clid) vira uma atribuicao so por cliente', () => {
    const { exec, consultar } = fakeD1();
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    const inserir = `INSERT OR IGNORE INTO meta_atribuicoes (tenant_id, phone_key, ctwa_clid) VALUES (5, '7191065853', 'clid-1')`;
    exec(inserir);
    exec(inserir);
    const [a] = consultar<{ n: number; origem: string; recebido_em: string }>(
      `SELECT COUNT(*) AS n, MAX(origem) AS origem, MAX(recebido_em) AS recebido_em FROM meta_atribuicoes`,
    );
    expect(a!.n).toBe(1);
    expect(a!.origem).toBe('evolution');
    expect(a!.recebido_em).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('meta_eventos deduplica por cliente e chave, e cliente novo nasce sem enviar', () => {
    const { exec, consultar } = fakeD1();
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key) VALUES (5, 3, 9, 'k')`);
    const inserir = `INSERT OR IGNORE INTO meta_eventos (tenant_id, dedupe_key, event_id, canal, event_name, event_at)
                     VALUES (5, 'P-LeadSubmitted', 'P-LeadSubmitted', 'whatsapp', 'LeadSubmitted', '2026-09-22T10:00:00Z')`;
    exec(inserir);
    exec(inserir);
    expect(consultar(`SELECT status, origem FROM meta_eventos`)).toEqual([{ status: 'pendente', origem: 'crm' }]);
    expect(consultar(`SELECT meta_dry_run, meta_token_valido FROM tenant_config`)).toEqual([
      { meta_dry_run: 1, meta_token_valido: 0 },
    ]);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run test/db/migracaoMetaCapi.test.ts`
Expected: FAIL — `ENOENT ... migrations/0029_meta_capi.sql` e `no such column: meta_evento`.

- [ ] **Passo 3: escrever a migração**

`migrations/0029_meta_capi.sql`:

```sql
-- Conversoes da Meta pelo CRM (fusao com o whatsapp-track).
-- Spec: docs/superpowers/specs/2026-09-22-meta-capi-no-crm-design.md
--
-- Tudo aditivo, menos `ingest_keys`, reconstruida porque SQLite nao altera
-- CHECK. Sem dataset da Meta no cadastro nenhum evento e' criado: para os
-- clientes de hoje nada muda.

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

-- `ingest_keys` ganha o canal 'evolution'. Tabela pequena; copia as linhas e
-- recria o mesmo indice do 0016.
PRAGMA foreign_keys = OFF;

CREATE TABLE ingest_keys_nova (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  canal       TEXT    NOT NULL CHECK (canal IN ('click','kanban','meta','evolution')),
  chave       TEXT    NOT NULL,
  revelada    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, canal)
);

INSERT INTO ingest_keys_nova (id, tenant_id, canal, chave, revelada, created_at)
SELECT id, tenant_id, canal, chave, revelada, created_at FROM ingest_keys;

DROP TABLE ingest_keys;
ALTER TABLE ingest_keys_nova RENAME TO ingest_keys;
CREATE INDEX idx_ingest_keys_tenant ON ingest_keys(tenant_id);

PRAGMA foreign_keys = ON;

-- O clique do anuncio (ctwa_clid) que a Evolution entregou, por telefone.
-- `recebido_em` no formato do D1 (o painel le' esse formato).
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
  recebido_em    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, ctwa_clid)
);
CREATE INDEX idx_meta_atrib_fone ON meta_atribuicoes(tenant_id, phone_key, recebido_em DESC);

-- Webhook que a instancia tinha antes do "Conectar": e' o que o "Restaurar
-- anterior" devolve. Guarda a URL inteira (pode ter o segredo de outro
-- sistema); a API so' expoe o host.
CREATE TABLE evo_webhooks_anteriores (
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evo_instancia  TEXT    NOT NULL,
  config         TEXT    NOT NULL,   -- json do /webhook/find
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

- [ ] **Passo 4: rodar e ver passar**

Run: `npx vitest run test/db/migracaoMetaCapi.test.ts`
Expected: PASS (5 testes).

Run: `npm test`
Expected: PASS — todos os testes antigos continuam verdes (o `fakeD1` já roda a migração nova).

- [ ] **Passo 5: commit**

```bash
git add migrations/0029_meta_capi.sql test/db/migracaoMetaCapi.test.ts
git commit -m "feat(meta): migracao 0029 - schema das conversoes da Meta

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tarefa 2: Ler o cartão do anúncio do corpo da Evolution

**Arquivos:**
- Criar: `src/domain/referralEvolution.ts`
- Teste: `test/domain/referralEvolution.test.ts`

**Interfaces:**
- Produz: `lerCartaoDaEvolution(raw: string): CartaoDoAnuncio | null` e
  `interface CartaoDoAnuncio { telefone: string; ctwaClid: string; adId: string | null; sourceUrl: string | null; titulo: string | null; instancia: string | null }` (`telefone` = só dígitos, com DDI).

- [ ] **Passo 1: escrever o teste que falha**

`test/domain/referralEvolution.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { lerCartaoDaEvolution } from '../../src/domain/referralEvolution';

/** `messages.upsert` da Evolution v2, no formato de um lead real de anuncio. */
function corpo(
  over: { event?: string; key?: Record<string, unknown>; message?: Record<string, unknown>; data?: Record<string, unknown> } = {},
) {
  return JSON.stringify({
    event: over.event ?? 'messages.upsert',
    instance: 'Tainã Aci',
    data: {
      key: { remoteJid: '5571991065853@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3', ...over.key },
      pushName: 'Maria',
      message: over.message ?? {
        extendedTextMessage: {
          text: 'Olá! Gostaria de mais informações [Protocolo: MA21RMKT]',
          contextInfo: {
            externalAdReply: {
              title: 'Harmonização facial',
              body: 'Agende sua avaliação',
              mediaType: 'IMAGE',
              jpegThumbnail: '/9j/4AAQSkZJRgABAQ-MINIATURA',
              sourceType: 'ad',
              sourceId: '120212345678900',
              sourceUrl: 'https://fb.me/abcDEF123',
              ctwaClid: 'ARAkLkA8rmlFeiCktEJQ-clid',
            },
          },
        },
      },
      messageType: 'extendedTextMessage',
      messageTimestamp: 1758540000,
      ...over.data,
    },
    date_time: '2026-09-22T10:00:00.000Z',
    apikey: 'segredo-da-instancia',
  });
}

describe('lerCartaoDaEvolution', () => {
  test('le o clique, o anuncio e a instancia do corpo real', () => {
    expect(lerCartaoDaEvolution(corpo())).toEqual({
      telefone: '5571991065853',
      ctwaClid: 'ARAkLkA8rmlFeiCktEJQ-clid',
      adId: '120212345678900',
      sourceUrl: 'https://fb.me/abcDEF123',
      titulo: 'Harmonização facial',
      instancia: 'Tainã Aci',
    });
  });

  test('a miniatura e a apikey nunca entram no resultado', () => {
    const r = JSON.stringify(lerCartaoDaEvolution(corpo()));
    expect(r).not.toContain('MINIATURA');
    expect(r).not.toContain('segredo-da-instancia');
  });

  test('acha o cartao em message.contextInfo', () => {
    const r = lerCartaoDaEvolution(corpo({
      message: { conversation: 'oi', contextInfo: { externalAdReply: { ctwaClid: 'c2' } } },
    }));
    expect(r?.ctwaClid).toBe('c2');
  });

  test('acha o cartao em data.contextInfo', () => {
    const r = lerCartaoDaEvolution(corpo({
      message: { conversation: 'oi' },
      data: { contextInfo: { externalAdReply: { ctwaClid: 'c3' } } },
    }));
    expect(r?.ctwaClid).toBe('c3');
  });

  test('acha o cartao numa mensagem de imagem', () => {
    const r = lerCartaoDaEvolution(corpo({
      message: { imageMessage: { caption: 'x', contextInfo: { externalAdReply: { ctwaClid: 'c4' } } } },
    }));
    expect(r?.ctwaClid).toBe('c4');
  });

  test('numero no endereco novo do WhatsApp (LID) vem do campo ao lado', () => {
    const r = lerCartaoDaEvolution(corpo({
      key: { remoteJid: '123456789012345@lid', remoteJidAlt: '5571991065853@s.whatsapp.net' },
    }));
    expect(r?.telefone).toBe('5571991065853');
  });

  test.each([
    ['grupo', corpo({ key: { remoteJid: '120363041234567890@g.us', senderPn: '5571991065853@s.whatsapp.net' } })],
    ['status', corpo({ key: { remoteJid: 'status@broadcast' } })],
    ['mensagem enviada pela empresa', corpo({ key: { fromMe: true } })],
    ['mensagem sem cartao', corpo({ message: { conversation: 'oi' } })],
    ['outro evento', corpo({ event: 'messages.update' })],
    ['LID sem numero', corpo({ key: { remoteJid: '123456789012345@lid' } })],
    ['json invalido', '{nao e json'],
  ])('%s nao e cartao de anuncio', (_, raw) => {
    expect(lerCartaoDaEvolution(raw)).toBeNull();
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run test/domain/referralEvolution.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/domain/referralEvolution"`.

- [ ] **Passo 3: implementar**

`src/domain/referralEvolution.ts`:

```ts
/**
 * O cartao do anuncio que a Evolution entrega junto da mensagem.
 *
 * Quem chama pelo WhatsApp a partir de um anuncio da Meta (click-to-WhatsApp)
 * manda a mensagem pronta, e o WhatsApp anexa o cartao do anuncio com o
 * `ctwa_clid` — o identificador do clique. A Meta so' aceita o evento de
 * campanha de mensagem com ele, e ele so' existe aqui: o Chatwoot recebe a
 * mensagem sem o cartao (a Taina tinha 57 cliques no tracker e 0 no CRM).
 *
 * Portado de `parseEvolutionBody` do whatsapp-track, so' a parte do anuncio.
 * A miniatura (`jpegThumbnail`) nunca sai daqui: e' imagem em base64 e nao
 * serve para atribuir nada.
 */

export interface CartaoDoAnuncio {
  /** Digitos do numero do lead, como o WhatsApp entregou (com DDI). */
  telefone: string;
  ctwaClid: string;
  adId: string | null;
  sourceUrl: string | null;
  titulo: string | null;
  /** Nome da instancia na Evolution. */
  instancia: string | null;
}

type Rec = Record<string, unknown>;

/** JID de pessoa. Grupo (`@g.us`), status e lista (`@broadcast`) nao sao lead. */
const PESSOA = /@(s\.whatsapp\.net|c\.us)$/i;
const COLETIVO = /@(g\.us|broadcast)$/i;

export function lerCartaoDaEvolution(raw: string): CartaoDoAnuncio | null {
  let raiz: unknown;
  try {
    raiz = JSON.parse(raw);
  } catch {
    return null;
  }
  const envelope = obj(raiz);
  if (!envelope) return null;

  // So' mensagem nova. Com `byEvents: false` a Evolution manda tudo no mesmo
  // endereco — presenca, leitura, contato — e nada disso traz cartao.
  const evento = str(envelope.event)?.toLowerCase().replace(/_/g, '.');
  if (evento && evento !== 'messages.upsert') return null;

  const bruto = envelope.data;
  const data = obj(Array.isArray(bruto) ? bruto[0] : bruto);
  if (!data) return null;

  const key = obj(data.key);
  if (key?.fromMe === true || data.fromMe === true) return null;

  const remoto = str(key?.remoteJid) ?? str(data.remoteJid) ?? '';
  if (COLETIVO.test(remoto)) return null;

  // Com o endereco novo do WhatsApp (LID) o `remoteJid` vem como `...@lid` e o
  // numero vai num campo ao lado.
  const jid = [remoto, key?.remoteJidAlt, key?.senderPn, data.senderPn]
    .map((v) => str(v))
    .find((j): j is string => !!j && PESSOA.test(j));
  if (!jid) return null;
  const telefone = jid.slice(0, jid.indexOf('@')).split(':')[0]!.replace(/\D/g, '');
  if (telefone.length < 10) return null;

  const message = obj(data.message);
  const contextos = [
    obj(message?.contextInfo),
    obj(obj(message?.extendedTextMessage)?.contextInfo),
    obj(data.contextInfo),
    ...Object.values(message ?? {}).map((v) => obj(obj(v)?.contextInfo)),
  ];
  const anuncio = contextos.map((c) => obj(c?.externalAdReply)).find((a) => a !== null) ?? null;

  const ctwaClid = str(anuncio?.ctwaClid) ?? str(anuncio?.ctwa_clid) ?? str(data.ctwaClid);
  if (!ctwaClid) return null;

  return {
    telefone,
    ctwaClid,
    adId: str(anuncio?.sourceId) ?? str(anuncio?.adId),
    sourceUrl: corta(str(anuncio?.sourceUrl) ?? str(anuncio?.source_url), 500),
    titulo: corta(str(anuncio?.title), 200),
    instancia: str(envelope.instance),
  };
}

function obj(v: unknown): Rec | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function corta(v: string | null, max: number): string | null {
  return v === null ? null : v.slice(0, max);
}
```

- [ ] **Passo 4: rodar e ver passar**

Run: `npx vitest run test/domain/referralEvolution.test.ts`
Expected: PASS (13 testes).

- [ ] **Passo 5: commit**

```bash
git add src/domain/referralEvolution.ts test/domain/referralEvolution.test.ts
git commit -m "feat(meta): le o cartao do anuncio (ctwa_clid) do corpo da Evolution

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tarefa 3: Rota `POST /ingest/:slug/evolution`

**Arquivos:**
- Modificar: `src/routes/ingest.ts` (`chaveDoCanal`, rota nova, ping)
- Teste: `test/routes/ingestEvolution.test.ts`

**Interfaces:**
- Consome: `lerCartaoDaEvolution` (Tarefa 2); `phoneKey`, `normFone` de `src/domain/phone.ts`; tabela `meta_atribuicoes` (Tarefa 1).
- Produz: endpoint público `POST /ingest/:slug/evolution?k=<chave do canal evolution>` → `200 { ok: true, gravado: boolean }` | `401` | `404`. `chaveDoCanal` passa a aceitar `'evolution'`.

- [ ] **Passo 1: escrever o teste que falha**

`test/routes/ingestEvolution.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { ingest } from '../../src/routes/ingest';
import type { Env } from '../../src/env';

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (5, 'taina', 'Taina', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key) VALUES (5, 3, 9, 'legado')`);
  exec(`INSERT INTO ingest_keys (tenant_id, canal, chave) VALUES (5, 'evolution', 'k-evo')`);
  const fila: unknown[] = [];
  const env = { DB: d1, QUEUE: { send: async (m: unknown) => { fila.push(m); } } } as unknown as Env;
  return { env, consultar, fila };
}

const CARTAO = JSON.stringify({
  event: 'messages.upsert',
  instance: 'Tainã Aci',
  data: {
    key: { remoteJid: '5571991065853@s.whatsapp.net', fromMe: false, id: 'A1' },
    message: {
      extendedTextMessage: {
        text: 'Olá! Gostaria de mais informações [Protocolo: MA21RMKT]',
        contextInfo: {
          externalAdReply: {
            title: 'Harmonização', sourceId: '1202', sourceUrl: 'https://fb.me/abc',
            ctwaClid: 'ARAk-clid', jpegThumbnail: '/9j/MINIATURA',
          },
        },
      },
    },
  },
});

const SEM_CARTAO = JSON.stringify({
  event: 'messages.upsert',
  data: { key: { remoteJid: '5571991065853@s.whatsapp.net', fromMe: false }, message: { conversation: 'oi' } },
});

const postar = (env: Env, corpo: string, k = 'k-evo') =>
  ingest.request(`/taina/evolution?k=${k}`, { method: 'POST', body: corpo }, env);

describe('POST /ingest/:slug/evolution', () => {
  test('chave errada: 401 e nada gravado', async () => {
    const { env, consultar } = cenario();
    const r = await postar(env, CARTAO, 'errada');
    expect(r.status).toBe(401);
    expect(consultar('SELECT * FROM meta_atribuicoes')).toHaveLength(0);
  });

  test('a chave antiga do cliente nao abre a Evolution', async () => {
    const { env } = cenario();
    expect((await postar(env, CARTAO, 'legado')).status).toBe(401);
  });

  test('mensagem sem cartao: 200 e nada gravado', async () => {
    const { env, consultar } = cenario();
    const r = await postar(env, SEM_CARTAO);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, gravado: false });
    expect(consultar('SELECT * FROM meta_atribuicoes')).toHaveLength(0);
  });

  test('com cartao: guarda o clique pelo telefone, sem miniatura e sem passar pela fila', async () => {
    const { env, consultar, fila } = cenario();
    const r = await postar(env, CARTAO);
    expect(await r.json()).toEqual({ ok: true, gravado: true });
    expect(consultar(`SELECT tenant_id, phone_key, phone_e164, ctwa_clid, ad_id, source_url, titulo,
                             evo_instancia, origem FROM meta_atribuicoes`)).toEqual([{
      tenant_id: 5, phone_key: '7191065853', phone_e164: '+5571991065853', ctwa_clid: 'ARAk-clid',
      ad_id: '1202', source_url: 'https://fb.me/abc', titulo: 'Harmonização',
      evo_instancia: 'Tainã Aci', origem: 'evolution',
    }]);
    expect(fila).toEqual([]);
    expect(consultar('SELECT * FROM events')).toHaveLength(0);
  });

  test('o mesmo clique reenviado vira uma linha so', async () => {
    const { env, consultar } = cenario();
    await postar(env, CARTAO);
    const r = await postar(env, CARTAO);
    expect(await r.json()).toEqual({ ok: true, gravado: false });
    expect(consultar('SELECT * FROM meta_atribuicoes')).toHaveLength(1);
  });

  test('corpo acima de 1 MB e descartado', async () => {
    const { env, consultar } = cenario();
    const enorme = CARTAO.replace('/9j/MINIATURA', 'x'.repeat(1_100_000));
    const r = await postar(env, enorme);
    expect(await r.json()).toEqual({ ok: true, gravado: false });
    expect(consultar('SELECT * FROM meta_atribuicoes')).toHaveLength(0);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run test/routes/ingestEvolution.test.ts`
Expected: FAIL — a rota não existe (404 onde se esperava 401/200).

- [ ] **Passo 3: implementar**

Em `src/routes/ingest.ts`:

1. Imports, no topo:

```ts
import { lerCartaoDaEvolution } from '../domain/referralEvolution';
import { phoneKey, normFone } from '../domain/phone';
```

2. Em `chaveDoCanal`, trocar o tipo do parâmetro `canal`:

```ts
  canal: 'click' | 'kanban' | 'meta' | 'evolution',
```

3. Na rota `GET /:slug/ping`, trocar a lista de canais:

```ts
  const canais = ['click', 'kanban', 'meta', 'evolution'] as const;
```

4. Acrescentar, depois da rota `/:slug/meta-lead`:

```ts
/** Acima disto e' midia embutida, nao mensagem de texto: nao ha cartao a ler. */
const LIMITE_CORPO_EVOLUTION = 1_000_000;

/**
 * Mensagens do WhatsApp, direto da Evolution — so' para guardar o clique do
 * anuncio da Meta (`ctwa_clid`).
 *
 * Nao vai para `events` nem para a fila: a instancia manda TODA mensagem, e
 * quase nenhuma tem cartao. A que tem vira uma linha em `meta_atribuicoes`,
 * que a atribuicao do lead (pelo Chatwoot) consulta pelo telefone.
 *
 * A chave e' so' a do canal `evolution`, sem cair na chave antiga do cliente:
 * este endereco nasceu depois da separacao por canal.
 */
ingest.post('/:slug/evolution', async (c) => {
  const tenant = await tenantPorSlug(c.env.DB, c.req.param('slug'));
  if (!tenant) return c.json({ ok: false, error: 'tenant desconhecido' }, 404);

  const chave = c.req.query('k') ?? c.req.header('X-Ingest-Key') ?? null;
  if (!(await chaveDoCanal(c.env.DB, tenant.id, 'evolution', null, chave))) {
    return c.json({ ok: false, error: 'chave invalida' }, 401);
  }

  if (Number(c.req.header('content-length') ?? 0) > LIMITE_CORPO_EVOLUTION) {
    return c.json({ ok: true, gravado: false });
  }
  const raw = await c.req.text();
  if (raw.length > LIMITE_CORPO_EVOLUTION) return c.json({ ok: true, gravado: false });

  const cartao = lerCartaoDaEvolution(raw);
  const chaveFone = cartao ? phoneKey(cartao.telefone) : '';
  if (!cartao || !chaveFone) return c.json({ ok: true, gravado: false });

  // UNIQUE (tenant_id, ctwa_clid): a Evolution reenvia, e o mesmo clique nao
  // pode virar duas atribuicoes
  const r = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO meta_atribuicoes
       (tenant_id, phone_key, phone_e164, ctwa_clid, ad_id, source_url, titulo, evo_instancia, origem)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'evolution')`,
  )
    .bind(
      tenant.id, chaveFone, normFone(cartao.telefone) || null, cartao.ctwaClid,
      cartao.adId, cartao.sourceUrl, cartao.titulo, cartao.instancia,
    )
    .run();

  return c.json({ ok: true, gravado: r.meta.changes > 0 });
});
```

- [ ] **Passo 4: rodar e ver passar**

Run: `npx vitest run test/routes/ingestEvolution.test.ts && npm run typecheck`
Expected: PASS (6 testes) e typecheck sem erro.

- [ ] **Passo 5: commit**

```bash
git add src/routes/ingest.ts test/routes/ingestEvolution.test.ts
git commit -m "feat(meta): rota /ingest/:slug/evolution guarda o clique do anuncio

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Tarefa 4: Conectar, listar e restaurar o webhook da Evolution

**Arquivos:**
- Criar: `src/domain/webhookEvolution.ts`
- Modificar: `src/clients/evolution.ts` (dois métodos novos)
- Criar: `src/pipelines/webhookEvolution.ts`
- Teste: `test/pipelines/webhookEvolution.test.ts`

**Interfaces:**
- Consome: `gerarIngestKey()` de `src/domain/tenantInput.ts`; `EvolutionClient.fromEnv(env)` e `estado(instancia)`; tabelas `ingest_keys`, `evo_webhooks_anteriores`, `meta_atribuicoes`, `inbox_instances`.
- Produz:
  - `EvolutionClient.webhook(instancia): Promise<WebhookEvo | null>` e `EvolutionClient.definirWebhook(instancia, d: DefinicaoWebhook): Promise<void>`;
  - `estadoDosWebhooks(env, tenantId, origem): Promise<InstanciaMeta[]>`;
  - `conectarWebhook(env, tenantId, origem, { instancia, confirmar? }): Promise<{ ok: true; instancia: string; host: string | null } | Falha>`;
  - `restaurarWebhook(env, tenantId, instancia): Promise<{ ok: true; instancia: string; host: string | null } | Falha>`;
  - `type Falha = { ok: false; status: 404 | 409 | 502; error: string; host?: string | null }`;
  - `interface InstanciaMeta { instancia: string; conexao: string; webhook: 'crm' | 'outro' | 'nenhum' | 'desconhecido'; host: string | null; ultimo_cartao: string | null; tem_anterior: boolean }`.
  - `origem` é o `origin` do próprio CRM (`new URL(c.req.url).origin`), usado para montar `https://<host>/ingest/<slug>/evolution?k=<chave>`.

- [ ] **Passo 1: escrever o teste que falha**

`test/pipelines/webhookEvolution.test.ts`:

```ts
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { conectarWebhook, estadoDosWebhooks, restaurarWebhook } from '../../src/pipelines/webhookEvolution';
import type { WebhookEvo } from '../../src/domain/webhookEvolution';
import type { Env } from '../../src/env';

const ORIGEM = 'https://crm.p12.teste';
const TRACKER = 'https://whatsapptrack.sitespdoze.com.br/hooks/evolution/1?secret=segredo-do-tracker';

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina'), (1, 'vita', 'Vita')`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key, evo_instancia)
        VALUES (5, 3, 9, 'k', 'Tainã Clínica'), (1, 2, 7, 'k', 'Vita Audio')`);
  exec(`INSERT INTO inbox_instances (tenant_id, cw_inbox_id, cw_inbox_nome, evo_instancia, ativa)
        VALUES (5, 11, 'Tainã', 'Tainã Aci', 1)`);
  const env = { DB: d1, EVOLUTION_SERVER_URL: 'https://evo.teste', EVOLUTION_API_KEY: 'x' } as unknown as Env;
  return { env, exec, consultar };
}

/** Evolution de mentira: um webhook por instancia, como a de verdade. */
let webhooks: Record<string, WebhookEvo | null>;
let gravados: Array<{ instancia: string; webhook: Record<string, unknown> }>;
let gravaOutraUrl: boolean;

beforeEach(() => {
  webhooks = {
    'Tainã Aci': {
      url: TRACKER, enabled: true, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
      webhookByEvents: false, webhookBase64: true,
    },
  };
  gravados = [];
  gravaOutraUrl = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const instancia = decodeURIComponent(u.pathname.split('/').pop()!);
    if (u.pathname.startsWith('/webhook/find/')) return Response.json(webhooks[instancia] ?? null);
    if (u.pathname.startsWith('/webhook/set/')) {
      const w = (JSON.parse(String(init.body)) as { webhook: Record<string, unknown> }).webhook;
      gravados.push({ instancia, webhook: w });
      webhooks[instancia] = gravaOutraUrl
        ? { url: 'https://outro.exemplo/x' }
        : {
            url: String(w.url), enabled: w.enabled as boolean, events: w.events as string[],
            webhookByEvents: w.byEvents as boolean, webhookBase64: w.base64 as boolean,
          };
      return Response.json({ webhook: w });
    }
    if (u.pathname.startsWith('/instance/connectionState/')) return Response.json({ instance: { state: 'open' } });
    return new Response('nao encontrado', { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('conectarWebhook', () => {
  test('instancia sem webhook: cria a chave do canal e grava o endereco do CRM', async () => {
    const { env, consultar } = cenario();
    const r = await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Clínica' });
    expect(r).toEqual({ ok: true, instancia: 'Tainã Clínica', host: 'crm.p12.teste' });

    const [k] = consultar<{ chave: string; revelada: number }>(
      `SELECT chave, revelada FROM ingest_keys WHERE canal = 'evolution'`,
    );
    expect(k!.revelada).toBe(0);
    expect(gravados).toEqual([{
      instancia: 'Tainã Clínica',
      webhook: {
        enabled: true,
        url: `${ORIGEM}/ingest/taina/evolution?k=${encodeURIComponent(k!.chave)}`,
        events: ['MESSAGES_UPSERT'],
        byEvents: false,
        base64: false,
      },
    }]);
    expect(consultar('SELECT * FROM evo_webhooks_anteriores')).toHaveLength(0);
  });

  test('aponta para outro sistema e sem confirmar: 409 com o host, nada gravado', async () => {
    const { env, consultar } = cenario();
    const r = await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Aci' });
    expect(r).toEqual({ ok: false, status: 409, error: expect.any(String), host: 'whatsapptrack.sitespdoze.com.br' });
    expect(JSON.stringify(r)).not.toContain('segredo-do-tracker');
    expect(gravados).toEqual([]);
    expect(consultar('SELECT * FROM evo_webhooks_anteriores')).toHaveLength(0);
  });

  test('com confirmar: guarda o anterior inteiro e grava o do CRM', async () => {
    const { env, consultar } = cenario();
    const r = await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Aci', confirmar: true });
    expect(r.ok).toBe(true);
    const [a] = consultar<{ config: string }>(`SELECT config FROM evo_webhooks_anteriores WHERE evo_instancia = 'Tainã Aci'`);
    expect(JSON.parse(a!.config).url).toBe(TRACKER);
    expect(String(gravados[0]!.webhook.url)).toContain(`${ORIGEM}/ingest/taina/evolution?k=`);
  });

  test('a Evolution ficou com outra URL depois de gravar: erro, nao "conectado"', async () => {
    const { env } = cenario();
    gravaOutraUrl = true;
    const r = await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Clínica' });
    expect(r).toMatchObject({ ok: false, status: 502 });
  });

  test('reconectar o que ja e do CRM nao apaga o anterior guardado', async () => {
    const { env, consultar } = cenario();
    await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Aci', confirmar: true });
    const r = await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Aci' });
    expect(r.ok).toBe(true);
    const [a] = consultar<{ config: string }>(`SELECT config FROM evo_webhooks_anteriores`);
    expect(JSON.parse(a!.config).url).toBe(TRACKER);
  });

  test('instancia de outro cliente: 404 e nada gravado', async () => {
    const { env } = cenario();
    const r = await conectarWebhook(env, 5, ORIGEM, { instancia: 'Vita Audio' });
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(gravados).toEqual([]);
  });
});

describe('restaurarWebhook', () => {
  test('devolve o webhook de antes, com os eventos de antes', async () => {
    const { env, consultar } = cenario();
    await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Aci', confirmar: true });
    const r = await restaurarWebhook(env, 5, 'Tainã Aci');
    expect(r).toEqual({ ok: true, instancia: 'Tainã Aci', host: 'whatsapptrack.sitespdoze.com.br' });
    expect(gravados[1]).toEqual({
      instancia: 'Tainã Aci',
      webhook: { enabled: true, url: TRACKER, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'], byEvents: false, base64: true },
    });
    expect(consultar('SELECT * FROM evo_webhooks_anteriores')).toHaveLength(0);
  });

  test('sem anterior guardado: 404', async () => {
    const { env } = cenario();
    expect(await restaurarWebhook(env, 5, 'Tainã Aci')).toMatchObject({ ok: false, status: 404 });
  });
});

describe('estadoDosWebhooks', () => {
  test('mostra conexao, o webhook so pelo host e o ultimo cartao recebido', async () => {
    const { env, exec } = cenario();
    exec(`INSERT INTO meta_atribuicoes (tenant_id, phone_key, ctwa_clid, evo_instancia, recebido_em)
          VALUES (5, '7191065853', 'c1', 'Tainã Aci', '2026-09-21 10:00:00')`);
    const r = await estadoDosWebhooks(env, 5, ORIGEM);
    expect(r).toEqual([
      {
        instancia: 'Tainã Aci', conexao: 'open', webhook: 'outro', host: 'whatsapptrack.sitespdoze.com.br',
        ultimo_cartao: '2026-09-21 10:00:00', tem_anterior: false,
      },
      { instancia: 'Tainã Clínica', conexao: 'open', webhook: 'nenhum', host: null, ultimo_cartao: null, tem_anterior: false },
    ]);
    expect(JSON.stringify(r)).not.toContain('segredo-do-tracker');
  });

  test('cliente sem instancia nenhuma nao chama a Evolution', async () => {
    const { d1, exec } = fakeD1();
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (7, 'tile', 'Tile')`);
    const env = { DB: d1 } as unknown as Env; // sem EVOLUTION_*: se chamasse, lancaria
    expect(await estadoDosWebhooks(env, 7, ORIGEM)).toEqual([]);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run test/pipelines/webhookEvolution.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/pipelines/webhookEvolution"`.

- [ ] **Passo 3: domínio**

`src/domain/webhookEvolution.ts`:

```ts
/**
 * O webhook de uma instancia da Evolution, visto pelo CRM.
 *
 * A Evolution aceita UM webhook por instancia. Apontar para o CRM desliga quem
 * estava la' antes (hoje, o whatsapp-track da Taina) — por isso o painel
 * pergunta antes e guarda o anterior para a volta atras.
 *
 * O endereco de outro sistema pode carregar o segredo dele na URL. Para a tela
 * sai so' o host.
 */

/** Como o `/webhook/find` devolve (Evolution v2). */
export interface WebhookEvo {
  url?: string;
  enabled?: boolean;
  events?: string[];
  webhookByEvents?: boolean;
  webhookBase64?: boolean;
  headers?: Record<string, string> | null;
  [campo: string]: unknown;
}

/** Corpo do `/webhook/set`, dentro de `{ webhook: ... }`. */
export interface DefinicaoWebhook {
  enabled: boolean;
  url: string;
  events: string[];
  byEvents: boolean;
  base64: boolean;
  headers?: Record<string, string>;
}

export type EstadoWebhook = 'crm' | 'outro' | 'nenhum' | 'desconhecido';

/** So' a mensagem nova interessa: e' nela que vem o cartao do anuncio. */
export const EVENTOS_DO_CRM = ['MESSAGES_UPSERT'];

export function urlDoCrm(origem: string, slug: string, chave: string): string {
  return `${origem.replace(/\/$/, '')}/ingest/${encodeURIComponent(slug)}/evolution?k=${encodeURIComponent(chave)}`;
}

export function hostDe(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/**
 * O webhook aponta para o CRM deste cliente? Compara host e caminho, sem a
 * chave: depois de girar a chave ele ainda e' do CRM, so' desatualizado.
 * `undefined` = nao foi possivel ler.
 */
export function estadoDoWebhook(w: WebhookEvo | null | undefined, origem: string, slug: string): EstadoWebhook {
  if (w === undefined) return 'desconhecido';
  if (!w?.url) return 'nenhum';
  try {
    const u = new URL(w.url);
    const crm = new URL(origem);
    return u.host === crm.host && decodeURIComponent(u.pathname) === `/ingest/${slug}/evolution` ? 'crm' : 'outro';
  } catch {
    return 'outro';
  }
}

/** O webhook guardado, de volta no formato do `/webhook/set`. */
export function definicaoDeVolta(w: WebhookEvo): DefinicaoWebhook {
  const d: DefinicaoWebhook = {
    enabled: w.enabled !== false,
    url: String(w.url ?? ''),
    events: Array.isArray(w.events) ? w.events.map(String) : [],
    byEvents: w.webhookByEvents === true,
    base64: w.webhookBase64 === true,
  };
  if (w.headers && typeof w.headers === 'object' && Object.keys(w.headers).length) d.headers = w.headers;
  return d;
}
```

- [ ] **Passo 4: cliente da Evolution**

Em `src/clients/evolution.ts`, acrescentar o import no topo:

```ts
import type { DefinicaoWebhook, WebhookEvo } from '../domain/webhookEvolution';
```

e, dentro da classe `EvolutionClient`, depois de `estado()`:

```ts
  /**
   * Webhook da instancia; `null` quando nao ha nenhum. A Evolution responde
   * `null` (ou corpo vazio) para instancia sem webhook.
   */
  async webhook(instancia: string): Promise<WebhookEvo | null> {
    let r: WebhookEvo | null;
    try {
      r = await this.req<WebhookEvo | null>(`/webhook/find/${encodeURIComponent(instancia)}`);
    } catch (e) {
      if (e instanceof SyntaxError) return null;
      throw e;
    }
    return r && typeof r === 'object' && typeof r.url === 'string' && r.url ? r : null;
  }

  /** Grava o webhook da instancia. Substitui o que havia: a Evolution guarda um so'. */
  async definirWebhook(instancia: string, d: DefinicaoWebhook): Promise<void> {
    await this.req(`/webhook/set/${encodeURIComponent(instancia)}`, { webhook: d });
  }
```

- [ ] **Passo 5: pipeline**

`src/pipelines/webhookEvolution.ts`:

```ts
import type { Env } from '../env';
import { EvolutionClient } from '../clients/evolution';
import { gerarIngestKey } from '../domain/tenantInput';
import {
  EVENTOS_DO_CRM, definicaoDeVolta, estadoDoWebhook, hostDe, urlDoCrm,
  type EstadoWebhook, type WebhookEvo,
} from '../domain/webhookEvolution';

/**
 * "Conectar na Evolution" em um clique.
 *
 * Sem o webhook da instancia apontando para o CRM nao chega `ctwa_clid`, e sem
 * ele a Meta nao aceita o evento de campanha de mensagem. Tudo acontece aqui,
 * do lado do servidor: a chave do canal e' criada se faltar, e quem clica nao
 * precisa ver nem copiar nada.
 */

export interface InstanciaMeta {
  instancia: string;
  /** `connectionState` da Evolution: 'open' = WhatsApp conectado. */
  conexao: string;
  webhook: EstadoWebhook;
  /** So' quando o webhook aponta para outro lugar. Nunca a URL inteira. */
  host: string | null;
  /** Ultimo cartao de anuncio recebido desta instancia: a prova de que chega. */
  ultimo_cartao: string | null;
  tem_anterior: boolean;
}

export type Falha = { ok: false; status: 404 | 409 | 502; error: string; host?: string | null };
type Conectado = { ok: true; instancia: string; host: string | null };

/** Instancias do cliente: as das caixas mapeadas e a do cadastro. */
export async function instanciasDoCliente(env: Env, tenantId: number): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT evo_instancia AS nome FROM inbox_instances WHERE tenant_id = ? AND ativa = 1
     UNION
     SELECT evo_instancia FROM tenant_config WHERE tenant_id = ? AND evo_instancia IS NOT NULL`,
  )
    .bind(tenantId, tenantId)
    .all<{ nome: string }>();
  return [...new Set(results.map((r) => r.nome).filter(Boolean))].sort();
}

async function slugDo(env: Env, tenantId: number): Promise<string | null> {
  const t = await env.DB.prepare('SELECT slug FROM tenants WHERE id = ?').bind(tenantId).first<{ slug: string }>();
  return t?.slug ?? null;
}

export async function estadoDosWebhooks(env: Env, tenantId: number, origem: string): Promise<InstanciaMeta[]> {
  const slug = await slugDo(env, tenantId);
  const nomes = slug ? await instanciasDoCliente(env, tenantId) : [];
  if (!slug || !nomes.length) return [];

  const evo = EvolutionClient.fromEnv(env);
  return Promise.all(
    nomes.map(async (instancia): Promise<InstanciaMeta> => {
      const [conexao, w, ultimo, anterior] = await Promise.all([
        evo.estado(instancia).catch(() => 'desconhecido'),
        evo.webhook(instancia).catch(() => undefined),
        env.DB.prepare('SELECT MAX(recebido_em) AS em FROM meta_atribuicoes WHERE tenant_id = ? AND evo_instancia = ?')
          .bind(tenantId, instancia)
          .first<{ em: string | null }>(),
        env.DB.prepare('SELECT 1 AS tem FROM evo_webhooks_anteriores WHERE tenant_id = ? AND evo_instancia = ?')
          .bind(tenantId, instancia)
          .first<{ tem: number }>(),
      ]);
      const webhook = estadoDoWebhook(w, origem, slug);
      return {
        instancia,
        conexao,
        webhook,
        host: webhook === 'outro' ? hostDe(w?.url) : null,
        ultimo_cartao: ultimo?.em ?? null,
        tem_anterior: !!anterior,
      };
    }),
  );
}

/** A chave do canal `evolution`; nasce aqui na primeira conexao. */
async function chaveDaEvolution(env: Env, tenantId: number): Promise<string> {
  // revelada = 0: fica a opcao de ver uma vez, para quem quiser configurar a mao
  await env.DB.prepare(
    `INSERT INTO ingest_keys (tenant_id, canal, chave, revelada) VALUES (?, 'evolution', ?, 0)
     ON CONFLICT (tenant_id, canal) DO NOTHING`,
  )
    .bind(tenantId, gerarIngestKey())
    .run();
  const l = await env.DB.prepare(`SELECT chave FROM ingest_keys WHERE tenant_id = ? AND canal = 'evolution'`)
    .bind(tenantId)
    .first<{ chave: string }>();
  return l!.chave;
}

export async function conectarWebhook(
  env: Env,
  tenantId: number,
  origem: string,
  pedido: { instancia: string; confirmar?: boolean },
): Promise<Conectado | Falha> {
  const slug = await slugDo(env, tenantId);
  if (!slug) return { ok: false, status: 404, error: 'cliente nao encontrado' };

  const instancia = String(pedido.instancia ?? '').trim();
  if (!(await instanciasDoCliente(env, tenantId)).includes(instancia)) {
    return { ok: false, status: 404, error: `a instancia "${instancia}" nao e' deste cliente` };
  }

  const url = urlDoCrm(origem, slug, await chaveDaEvolution(env, tenantId));
  const evo = EvolutionClient.fromEnv(env);

  let atual: WebhookEvo | null;
  try {
    atual = await evo.webhook(instancia);
  } catch (e) {
    return { ok: false, status: 502, error: `a Evolution nao respondeu: ${(e as Error).message.slice(0, 200)}` };
  }

  const estado = estadoDoWebhook(atual, origem, slug);
  if (estado === 'outro' && !pedido.confirmar) {
    return {
      ok: false,
      status: 409,
      error: 'o webhook desta instancia aponta para outro lugar',
      host: hostDe(atual?.url),
    };
  }

  // Guarda o de antes para o "Restaurar anterior". Reconectar o que ja' e' do
  // CRM (depois de girar a chave) nao pode apagar o anterior de verdade.
  if (atual && estado === 'outro') {
    await env.DB.prepare(
      `INSERT INTO evo_webhooks_anteriores (tenant_id, evo_instancia, config) VALUES (?, ?, ?)
       ON CONFLICT (tenant_id, evo_instancia) DO UPDATE SET config = excluded.config, salvo_em = datetime('now')`,
    )
      .bind(tenantId, instancia, JSON.stringify(atual))
      .run();
  }

  try {
    // base64 false: sem isto a midia vem embutida no corpo
    await evo.definirWebhook(instancia, { enabled: true, url, events: EVENTOS_DO_CRM, byEvents: false, base64: false });
    const depois = await evo.webhook(instancia);
    if (depois?.url !== url) {
      return {
        ok: false,
        status: 502,
        error: `a Evolution nao gravou o endereco do CRM (hoje: ${hostDe(depois?.url) ?? 'sem webhook'})`,
      };
    }
  } catch (e) {
    return { ok: false, status: 502, error: `a Evolution recusou: ${(e as Error).message.slice(0, 200)}` };
  }

  console.log(JSON.stringify({ acao: 'evolution_conectada', tenant_id: tenantId, instancia }));
  return { ok: true, instancia, host: hostDe(url) };
}

/** A volta atras da virada: devolve o webhook que a instancia tinha antes. */
export async function restaurarWebhook(env: Env, tenantId: number, instancia: string): Promise<Conectado | Falha> {
  const l = await env.DB.prepare('SELECT config FROM evo_webhooks_anteriores WHERE tenant_id = ? AND evo_instancia = ?')
    .bind(tenantId, instancia)
    .first<{ config: string }>();
  if (!l) return { ok: false, status: 404, error: 'nao ha webhook anterior guardado para esta instancia' };

  const volta = definicaoDeVolta(JSON.parse(l.config) as WebhookEvo);
  const evo = EvolutionClient.fromEnv(env);
  try {
    await evo.definirWebhook(instancia, volta);
    const depois = await evo.webhook(instancia);
    if (depois?.url !== volta.url) {
      return { ok: false, status: 502, error: 'a Evolution nao gravou o webhook anterior' };
    }
  } catch (e) {
    return { ok: false, status: 502, error: `a Evolution recusou: ${(e as Error).message.slice(0, 200)}` };
  }

  await env.DB.prepare('DELETE FROM evo_webhooks_anteriores WHERE tenant_id = ? AND evo_instancia = ?')
    .bind(tenantId, instancia)
    .run();
  console.log(JSON.stringify({ acao: 'evolution_restaurada', tenant_id: tenantId, instancia }));
  return { ok: true, instancia, host: hostDe(volta.url) };
}
```

- [ ] **Passo 6: rodar e ver passar**

Run: `npx vitest run test/pipelines/webhookEvolution.test.ts && npm run typecheck`
Expected: PASS (11 testes) e typecheck sem erro.

- [ ] **Passo 7: commit**

```bash
git add src/domain/webhookEvolution.ts src/clients/evolution.ts src/pipelines/webhookEvolution.ts test/pipelines/webhookEvolution.test.ts
git commit -m "feat(meta): conectar e restaurar o webhook da Evolution pelo servidor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tarefa 5: Rotas do painel para a Evolution e canal `evolution` nas chaves

**Arquivos:**
- Criar: `src/routes/metaAds.ts`
- Modificar: `src/routes/admin.ts` (lista `CANAIS`, `trocar` do `gerar`, montagem do `metaAds`)
- Modificar: `src/routes/api.ts` (`/tenants/:id/ingest-status`)
- Teste: `test/routes/metaAds.test.ts`

**Interfaces:**
- Consome: `estadoDosWebhooks`, `conectarWebhook`, `restaurarWebhook` (Tarefa 4).
- Produz:
  - `GET /api/tenants/:id/evolution/webhook` → `{ instancias: InstanciaMeta[] }`;
  - `POST /api/tenants/:id/evolution/webhook` com `{ instancia, confirmar? }` → `200 { ok, instancia, host }` ou `{ error, host }` com status 404/409/502;
  - `POST /api/tenants/:id/evolution/webhook/restaurar` com `{ instancia }` → idem;
  - `export const metaAds` (Hono), montado dentro de `admin` — a Tarefa 14 acrescenta rotas nele;
  - `ingest-status` ganha `evolution: { total, em_24h, erros, ultimo }` (contagem de cartões guardados).

- [ ] **Passo 1: escrever o teste que falha**

`test/routes/metaAds.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import worker from '../../src/index';
import { fakeD1 } from '../helpers/fakeD1';
import type { Env } from '../../src/env';

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const pedir = (env: Env, caminho: string) => worker.fetch(new Request(`https://crm.teste${caminho}`), env, ctx);

describe('rotas da Meta Ads no painel', () => {
  test('ficam atras do Access', async () => {
    const { d1 } = fakeD1();
    const env = { DB: d1, CF_ACCESS_TEAM_DOMAIN: 'p12.cloudflareaccess.com', CF_ACCESS_AUD: 'aud' } as unknown as Env;
    expect((await pedir(env, '/api/tenants/5/evolution/webhook')).status).toBe(401);
  });

  test('estao montadas: cliente sem instancia responde lista vazia', async () => {
    const { d1, exec } = fakeD1();
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    const env = { DB: d1, PANEL_PUBLIC: 'true' } as unknown as Env;
    const r = await pedir(env, '/api/tenants/5/evolution/webhook');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ instancias: [] });
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run test/routes/metaAds.test.ts`
Expected: FAIL no segundo teste — a rota não existe e a requisição cai no `app.all('*')` do painel (`ASSETS` ausente no env de teste).

- [ ] **Passo 3: criar as rotas**

`src/routes/metaAds.ts`:

```ts
import { Hono } from 'hono';
import type { Env } from '../env';
import type { AccessIdentity } from '../middleware/access';
import { conectarWebhook, estadoDosWebhooks, restaurarWebhook } from '../pipelines/webhookEvolution';

/**
 * Meta Ads no perfil do cliente: o webhook da Evolution (de onde vem o clique
 * do anuncio) e a conexao com a Conversions API.
 *
 * Montado dentro de `admin` (`admin.route('/', metaAds)`), atras do mesmo
 * Access. A regra fica nos pipelines; aqui so' se traduz para HTTP.
 */
export const metaAds = new Hono<{ Bindings: Env; Variables: { identity: AccessIdentity } }>();

/** O endereco do proprio CRM, para montar a URL que vai para a Evolution. */
const origemDe = (url: string) => new URL(url).origin;

interface PedidoInstancia {
  instancia?: string;
  confirmar?: boolean;
}

metaAds.get('/tenants/:id/evolution/webhook', async (c) => {
  const instancias = await estadoDosWebhooks(c.env, Number(c.req.param('id')), origemDe(c.req.url));
  return c.json({ instancias });
});

metaAds.post('/tenants/:id/evolution/webhook', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<PedidoInstancia>().catch((): PedidoInstancia => ({}));
  const r = await conectarWebhook(c.env, id, origemDe(c.req.url), {
    instancia: String(b.instancia ?? ''),
    confirmar: b.confirmar === true,
  });
  console.log(JSON.stringify({
    acao: 'conectar_evolution', por: c.get('identity')?.email, tenant_id: id, instancia: b.instancia, ok: r.ok,
  }));
  if (!r.ok) return c.json({ error: r.error, host: r.host ?? null }, r.status);
  return c.json(r);
});

metaAds.post('/tenants/:id/evolution/webhook/restaurar', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<PedidoInstancia>().catch((): PedidoInstancia => ({}));
  const r = await restaurarWebhook(c.env, id, String(b.instancia ?? ''));
  console.log(JSON.stringify({
    acao: 'restaurar_evolution', por: c.get('identity')?.email, tenant_id: id, instancia: b.instancia, ok: r.ok,
  }));
  if (!r.ok) return c.json({ error: r.error, host: r.host ?? null }, r.status);
  return c.json(r);
});
```

- [ ] **Passo 4: montar e abrir o canal `evolution` em `admin.ts`**

1. Import no topo de `src/routes/admin.ts`:

```ts
import { metaAds } from './metaAds';
```

2. Trocar a lista de canais (hoje `const CANAIS = ['click', 'kanban', 'meta'] as const;`):

```ts
const CANAIS = ['click', 'kanban', 'meta', 'evolution'] as const;
```

3. Em `admin.post('/tenants/:id/webhooks/:canal/gerar', ...)`, trocar o objeto `trocar` por:

```ts
  const trocar: Record<Canal, string[]> = {
    click: [`${base}/click?k=${nova}`],
    kanban: [`${base}/kanban?k=${nova}`, `${base}/kanban?k=${nova}&evento=conversao`],
    meta: [`${base}/meta-lead?k=${nova}`],
    // a instancia ligada pelo "Conectar" para de entregar ate' conectar de novo
    evolution: [`${base}/evolution?k=${nova}`],
  };
```

4. Na **última linha** de `src/routes/admin.ts`:

```ts
// Meta Ads: montado depois do `use('*', requireAccess)` do topo, que vale para estas rotas tambem
admin.route('/', metaAds);
```

- [ ] **Passo 5: `ingest-status` conta os cartões da Evolution**

Em `src/routes/api.ts`, na rota `api.get('/tenants/:id/ingest-status', ...)`, antes do `return c.json({`, acrescentar:

```ts
  // A Evolution nao grava em `events`: so' o cartao do anuncio vira linha
  const evo = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total, MAX(recebido_em) AS ultimo,
            SUM(CASE WHEN recebido_em >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS em_24h
     FROM meta_atribuicoes WHERE tenant_id = ? AND origem = 'evolution'`,
  )
    .bind(Number(c.req.param('id')))
    .first<{ total: number; ultimo: string | null; em_24h: number | null }>();
```

e, dentro do objeto devolvido, depois de `meta: junta(...)`:

```ts
    evolution: { total: evo?.total ?? 0, em_24h: evo?.em_24h ?? 0, erros: 0, ultimo: evo?.ultimo ?? null },
```

- [ ] **Passo 6: rodar e ver passar**

Run: `npx vitest run test/routes/metaAds.test.ts && npm test && npm run typecheck`
Expected: PASS (2 testes novos; suíte inteira verde; typecheck sem erro).

- [ ] **Passo 7: commit**

```bash
git add src/routes/metaAds.ts src/routes/admin.ts src/routes/api.ts test/routes/metaAds.test.ts
git commit -m "feat(meta): rotas do webhook da Evolution e canal evolution nas chaves

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tarefa 6: Painel — aba "Meta Ads" com o WhatsApp (Evolution)

**Arquivos:**
- Modificar: `panel/index.html`

**Interfaces:**
- Consome: as rotas da Tarefa 5.
- Produz: aba `meta` no perfil do cliente, seção `whatsapp` (destino `meta/whatsapp`); a Tarefa 16 acrescenta as seções `conexao`, `etapas` e `eventos`. `enviar()` passa a anexar `status` e `corpo` ao erro.

O painel segue o contrato de design do cabeçalho do CSS: cor só para status, monoespaçada só para identificador, seção é régua e espaço. Não crie classe de cor nova.

- [ ] **Passo 1: `enviar()` devolve o status e o corpo do erro**

Em `async function enviar(caminho, metodo, corpo)`, trocar:

```js
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
        return j;
```

por:

```js
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          // o "Conectar" precisa do 409 e do host para perguntar antes de substituir
          const erro = new Error(j.error || 'HTTP ' + r.status);
          erro.status = r.status;
          erro.corpo = j;
          throw erro;
        }
        return j;
```

- [ ] **Passo 2: a aba**

No `verCliente`, depois de
`<button class="aba" role="tab" data-aba="google" aria-selected="false">Google Ads</button>`, acrescentar:

```html
            <button class="aba" role="tab" data-aba="meta" aria-selected="false">Meta Ads</button>
```

- [ ] **Passo 3: o painel da aba**

Logo antes de `<div class="painel" data-painel="planilha" hidden>`, acrescentar:

```html
          <div class="painel" data-painel="meta" hidden>
            <div class="secoes">
              <nav class="secoes-menu" aria-label="Seções da Meta Ads">
                <button data-secao="whatsapp">WhatsApp (Evolution)</button>
              </nav>
              <div class="secoes-corpo">
                <div class="secao-grupo" data-secao="whatsapp">
                  <section>
                    <header class="secao-topo">
                      <div>
                        <h2>Clique do anúncio no WhatsApp</h2>
                        <p class="dica">A Meta só conta a conversão da campanha de mensagem com o clique do anúncio
                        (<code>ctwa_clid</code>), e ele só chega pela Evolution. <strong>Conectar</strong> aponta o
                        webhook da instância para o CRM. A Evolution aceita um webhook por instância: o endereço de
                        antes para de receber e fica guardado para <strong>Restaurar anterior</strong>.</p>
                      </div>
                      <span class="carregando" id="evo-estado"></span>
                    </header>
                    <div id="evo-instancias"></div>
                  </section>
                </div>
              </div>
            </div>
          </div>
```

- [ ] **Passo 4: carregar a seção**

No objeto `CARGAS` do `verCliente`, depois de `'google/conversoes': () => carregarConversoes(id, 0),`:

```js
          'meta/whatsapp': () => carregarWebhooksEvolution(id),
```

- [ ] **Passo 5: as funções da seção**

Logo depois da função `carregarInstancias(id)`:

```js
      /**
       * Instâncias da Evolution do cliente e para onde cada webhook aponta.
       *
       * O endereço de outro sistema pode ter o segredo dele na URL: a API manda
       * só o host, e é só o host que a tela mostra.
       */
      async function carregarWebhooksEvolution(id) {
        const alvo = document.getElementById('evo-instancias');
        if (!alvo) return;
        alvo.innerHTML = CARREGANDO;
        let r;
        try {
          r = await api('/tenants/' + id + '/evolution/webhook');
        } catch (e) {
          alvo.innerHTML = '<p class="carregando">falhou: ' + esc(e.message) + '</p>';
          return;
        }
        if (!r.instancias.length) {
          alvo.innerHTML = '<div class="vazio"><p>Nenhuma instância da Evolution neste cliente.</p>' +
            '<p class="mono">Cadastre a instância em Editar cliente ou mapeie as caixas em Canais → WhatsApp.</p></div>';
          return;
        }

        const webhook = function (l) {
          if (l.webhook === 'crm') return '<span class="st-ok">conectado ao CRM</span>';
          if (l.webhook === 'outro') return '<span class="st-ignorado">aponta para <code>' + esc(l.host || '?') + '</code></span>';
          if (l.webhook === 'nenhum') return '<span class="nada">sem webhook</span>';
          return '<span class="nada">não foi possível ler</span>';
        };

        alvo.innerHTML = '<table><thead><tr><th>Instância</th><th>WhatsApp</th><th>Webhook</th>' +
          '<th>Último clique de anúncio</th><th></th></tr></thead><tbody>' +
          r.instancias.map(function (l) {
            return '<tr><td>' + esc(l.instancia) + '</td>' +
              '<td>' + (l.conexao === 'open'
                ? '<span class="st-ok">conectado</span>'
                : '<span class="st-erro">' + esc(l.conexao) + '</span>') + '</td>' +
              '<td>' + webhook(l) + '</td>' +
              '<td>' + (l.ultimo_cartao ? esc(haQuanto(l.ultimo_cartao)) : '<span class="nada">nenhum ainda</span>') + '</td>' +
              '<td class="acoes-etiqueta">' +
                (l.webhook !== 'crm'
                  ? '<button class="evo-conectar principal" data-inst="' + esc(l.instancia) + '">Conectar</button>'
                  : '') +
                (l.tem_anterior
                  ? '<button class="evo-restaurar" data-inst="' + esc(l.instancia) + '">Restaurar anterior</button>'
                  : '') +
              '</td></tr>';
          }).join('') + '</tbody></table>';

        alvo.querySelectorAll('.evo-conectar').forEach(function (b) {
          b.addEventListener('click', function () { conectarEvolution(id, b.dataset.inst, false); });
        });
        alvo.querySelectorAll('.evo-restaurar').forEach(function (b) {
          b.addEventListener('click', function () { restaurarEvolution(id, b.dataset.inst); });
        });
      }

      async function conectarEvolution(id, inst, confirmar) {
        const estado = document.getElementById('evo-estado');
        estado.textContent = 'conectando ' + inst + '…';
        try {
          const r = await enviar('/tenants/' + id + '/evolution/webhook', 'POST', { instancia: inst, confirmar: confirmar });
          estado.textContent = inst + ': conectado ao CRM (' + r.host + ')';
        } catch (e) {
          if (e.status === 409 && e.corpo && !confirmar) {
            estado.textContent = '';
            const host = e.corpo.host || 'outro sistema';
            if (confirm('Hoje o webhook de "' + inst + '" aponta para ' + host + '.\n\n' +
              'Conectar ao CRM substitui esse endereço: ' + host + ' para de receber as mensagens desta instância. ' +
              'O endereço de hoje fica guardado e volta com "Restaurar anterior".\n\nSubstituir?')) {
              return conectarEvolution(id, inst, true);
            }
            return;
          }
          estado.textContent = 'não conectou: ' + e.message;
          return;
        }
        carregarWebhooksEvolution(id);
      }

      async function restaurarEvolution(id, inst) {
        if (!confirm('Devolver o webhook de "' + inst + '" para o endereço de antes?\n\n' +
          'O CRM para de receber o clique do anúncio desta instância.')) return;
        const estado = document.getElementById('evo-estado');
        estado.textContent = 'restaurando ' + inst + '…';
        try {
          const r = await enviar('/tenants/' + id + '/evolution/webhook/restaurar', 'POST', { instancia: inst });
          estado.textContent = inst + ': devolvido para ' + r.host;
        } catch (e) {
          estado.textContent = 'não restaurou: ' + e.message;
          return;
        }
        carregarWebhooksEvolution(id);
      }
```

- [ ] **Passo 6: o endereço da Evolution em "Endereços de entrada"**

No array `const CANAIS = [` (lista dos endereços de entrada, perto de `let chavesVisiveis`), depois do item `id: 'meta'`, acrescentar:

```js
        {
          id: 'evolution', rota: '/evolution', titulo: 'Evolution · clique do anúncio da Meta',
          dica: 'Recebe as mensagens do WhatsApp e guarda só o clique do anúncio (<code>ctwa_clid</code>). ' +
            'O jeito certo de ligar é o botão <strong>Conectar</strong> em Meta Ads → WhatsApp; este endereço é para ' +
            'configurar à mão. Gerar uma chave nova desconecta as instâncias já ligadas: depois, conecte de novo.',
          uso: 'evolution',
        },
```

- [ ] **Passo 7: conferir a sintaxe do script do painel**

Run:

```bash
node -e "const h=require('fs').readFileSync('panel/index.html','utf8');const m=[...h.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)];m.forEach((x,i)=>{try{new Function(x[1])}catch(e){console.error('script',i,e.message);process.exit(1)}});console.log(m.length+' scripts ok')"
```

Expected: `1 scripts ok`.

Run: `npm test && npm run typecheck`
Expected: verde.

- [ ] **Passo 8: commit**

```bash
git add panel/index.html
git commit -m "feat(painel): aba Meta Ads com o Conectar da Evolution

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

> **Ponto de parada A (opcional).** A Parte A pode ir para produção sozinha. Ordem: `npx wrangler d1 migrations apply crm_auto --remote` **antes** do push (o código novo lê as colunas novas; o código velho convive com o schema novo). Depois do deploy, abra Tainã → Meta Ads → WhatsApp: "Tainã Aci" deve aparecer "aponta para `whatsapptrack.sitespdoze.com.br`". **Não clique em Conectar na Tainã antes da virada (Tarefa 18):** isso desliga o tracker, que hoje é quem manda o `LeadSubmitted`.

---

# Parte B — Motor de envio para a Meta

### Tarefa 7: Cifra do token da Meta (port do tracker)

**Arquivos:**
- Criar: `src/domain/segredoMeta.ts`
- Modificar: `src/env.ts` (`MASTER_KEY`)
- Teste: `test/domain/segredoMeta.test.ts`

**Interfaces:**
- Produz: `cifrarToken(token, masterKey): Promise<{ cipher: string; iv: string }>`, `decifrarToken(cipher, iv, masterKey): Promise<string>` (lança se adulterado ou chave errada), `ultimos4(token): string`; `Env.MASTER_KEY?: string`.

- [ ] **Passo 1: escrever o teste que falha**

`test/domain/segredoMeta.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { cifrarToken, decifrarToken, ultimos4 } from '../../src/domain/segredoMeta';

const MK = 'chave-mestra-de-teste';

describe('segredoMeta', () => {
  test('ida e volta', async () => {
    const c = await cifrarToken('EAAB-token-1234', MK);
    expect(await decifrarToken(c.cipher, c.iv, MK)).toBe('EAAB-token-1234');
  });

  test('IV novo a cada cifra: o mesmo token nunca vira o mesmo texto', async () => {
    const a = await cifrarToken('EAAB-token-1234', MK);
    const b = await cifrarToken('EAAB-token-1234', MK);
    expect(a.iv).not.toBe(b.iv);
    expect(a.cipher).not.toBe(b.cipher);
  });

  test('abre o token que o whatsapp-track cifrou', async () => {
    // gerado com o algoritmo de whatsapp-track/src/lib/crypto.ts, IV fixo 1..12
    const cipher = 'K8D9KD+3v4mI/o7q3fJXyAWteVJga/0yV2H7bMuaQj8b5Ey6qBMLnw==';
    expect(await decifrarToken(cipher, 'AQIDBAUGBwgJCgsM', MK)).toBe('EAAB-token-de-teste-1234');
  });

  test('cifra adulterada lanca', async () => {
    const c = await cifrarToken('EAAB-token-1234', MK);
    const adulterada = (c.cipher[0] === 'A' ? 'B' : 'A') + c.cipher.slice(1);
    await expect(decifrarToken(adulterada, c.iv, MK)).rejects.toThrow();
  });

  test('outra MASTER_KEY nao abre', async () => {
    const c = await cifrarToken('EAAB-token-1234', MK);
    await expect(decifrarToken(c.cipher, c.iv, 'outra-chave')).rejects.toThrow();
  });

  test('ultimos4 nao revela token curto', () => {
    expect(ultimos4('EAAB-token-1234')).toBe('1234');
    expect(ultimos4('1234')).toBe('');
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run test/domain/segredoMeta.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/domain/segredoMeta"`.

- [ ] **Passo 3: implementar**

`src/domain/segredoMeta.ts`:

```ts
/**
 * Token da Meta cifrado em repouso no D1.
 *
 * Portado de `whatsapp-track/src/lib/crypto.ts` sem mudar o algoritmo: a
 * MASTER_KEY do CRM e' a mesma do tracker, e o token da Taina vem de la' ainda
 * cifrado. AES-GCM, chave = SHA-256 da MASTER_KEY, IV novo a cada cifra —
 * reusar IV em GCM quebra o sigilo.
 */

const IV_BYTES = 12;

function paraBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function deBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function chave(masterKey: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(masterKey));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function cifrarToken(token: string, masterKey: string): Promise<{ cipher: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chave(masterKey), new TextEncoder().encode(token));
  return { cipher: paraBase64(new Uint8Array(cifrado)), iv: paraBase64(iv) };
}

/** Lanca se a cifra foi adulterada ou se a MASTER_KEY nao e' a que cifrou. */
export async function decifrarToken(cipher: string, iv: string, masterKey: string): Promise<string> {
  const aberto = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64(iv) }, await chave(masterKey), deBase64(cipher));
  return new TextDecoder().decode(aberto);
}

/** Os 4 ultimos, para a tela reconhecer o token. Token curto: nada, senao seria o token inteiro. */
export function ultimos4(token: string): string {
  return token.length > 4 ? token.slice(-4) : '';
}
```

- [ ] **Passo 4: `MASTER_KEY` no `Env`**

Em `src/env.ts`, dentro de `interface Env`, antes de `// Cloudflare Access`:

```ts
  /**
   * Cifra o token da Meta de cada cliente (AES-GCM). E' a MESMA do
   * whatsapp-track: o token da Taina veio de la' ainda cifrado. Perder esta
   * chave = recadastrar o token de todo cliente. Backup: `MASTER_KEY_PROD` no
   * `.env` local.
   */
  MASTER_KEY?: string;
```

- [ ] **Passo 5: rodar e ver passar**

Run: `npx vitest run test/domain/segredoMeta.test.ts && npm run typecheck`
Expected: PASS (6 testes) e typecheck sem erro.

- [ ] **Passo 6: commit**

```bash
git add src/domain/segredoMeta.ts src/env.ts test/domain/segredoMeta.test.ts
git commit -m "feat(meta): cifra do token da Meta, compativel com o whatsapp-track

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tarefa 8: Para onde volta a conversão do lead

**Arquivos:**
- Criar: `src/domain/plataformaLead.ts`
- Teste: `test/domain/plataformaLead.test.ts`

**Interfaces:**
- Produz:
  - `interface SinaisDoLead { gclid; gbraid; wbraid; ctwa_clid; fbc; evento; utm_source }` (todos `string | null`);
  - `type CanalMeta = 'whatsapp' | 'site'`; `type MotivoForaDaMeta = 'formulario' | 'sem_identificador'`;
  - `type Destino = { plataforma: 'google' } | { plataforma: 'meta'; canal: CanalMeta } | { plataforma: 'meta'; fora: MotivoForaDaMeta }`;
  - `destinoDoLead(l: SinaisDoLead): Destino`;
  - `MOTIVO_FORA: Record<MotivoForaDaMeta, string>`.

- [ ] **Passo 1: escrever o teste que falha**

`test/domain/plataformaLead.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { destinoDoLead, type SinaisDoLead } from '../../src/domain/plataformaLead';

const lead = (over: Partial<SinaisDoLead> = {}): SinaisDoLead => ({
  gclid: null, gbraid: null, wbraid: null, ctwa_clid: null, fbc: null, evento: null, utm_source: null, ...over,
});

describe('destinoDoLead', () => {
  test('clique do Google vai para o Google', () => {
    expect(destinoDoLead(lead({ gclid: 'Cj0' }))).toEqual({ plataforma: 'google' });
    expect(destinoDoLead(lead({ gbraid: 'gb' }))).toEqual({ plataforma: 'google' });
    expect(destinoDoLead(lead({ wbraid: 'wb' }))).toEqual({ plataforma: 'google' });
  });

  test('gclid vence o fbc e o ctwa_clid: o clique do Google e o mais forte', () => {
    expect(destinoDoLead(lead({ gclid: 'Cj0', fbc: 'fb.1.2.3', ctwa_clid: 'c' }))).toEqual({ plataforma: 'google' });
  });

  test('ctwa_clid vai para a Meta pelo canal de mensagem', () => {
    expect(destinoDoLead(lead({ ctwa_clid: 'ARAk', utm_source: 'facebook' }))).toEqual({ plataforma: 'meta', canal: 'whatsapp' });
  });

  test('formulario nativo da Meta fica de fora', () => {
    expect(destinoDoLead(lead({ evento: 'meta_lead_form', utm_source: 'meta' })))
      .toEqual({ plataforma: 'meta', fora: 'formulario' });
  });

  test('fbc vai para a Meta pelo canal do site', () => {
    expect(destinoDoLead(lead({ fbc: 'fb.1.2.3', utm_source: 'meta' }))).toEqual({ plataforma: 'meta', canal: 'site' });
  });

  test('rede da Meta sem identificador: e da Meta, mas nao ha o que enviar', () => {
    expect(destinoDoLead(lead({ utm_source: ' Instagram ' }))).toEqual({ plataforma: 'meta', fora: 'sem_identificador' });
    expect(destinoDoLead(lead({ utm_source: 'meta', evento: 'frase_entrada' })))
      .toEqual({ plataforma: 'meta', fora: 'sem_identificador' });
  });

  test('o resto segue para o Google, como hoje', () => {
    expect(destinoDoLead(lead())).toEqual({ plataforma: 'google' });
    expect(destinoDoLead(lead({ utm_source: 'digital' }))).toEqual({ plataforma: 'google' });
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run test/domain/plataformaLead.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/domain/plataformaLead"`.

- [ ] **Passo 3: implementar**

`src/domain/plataformaLead.ts`:

```ts
/**
 * Para qual plataforma de anuncio a conversao deste lead volta.
 *
 * Substitui o `ehDoMeta` do stageChanged, que so' sabia dizer "nao e' do
 * Google". Agora o lead da Meta tem para onde ir: a Conversions API, por um de
 * dois canais — o clique no anuncio de mensagem (`ctwa_clid`) ou o cookie do
 * pixel no site (`fbc`).
 *
 * A ordem e' a decisao:
 *  1. clique do Google (gclid/gbraid/wbraid) vence tudo: e' mais forte e mais
 *     recente que um cookie de pixel, que so' prova que a pessoa passou pela Meta;
 *  2. ctwa_clid → Meta, canal whatsapp;
 *  3. formulario nativo da Meta → fica de fora (decisao da fase 1);
 *  4. fbc → Meta, canal site;
 *  5. utm de rede da Meta sem identificador → e' da Meta, mas a CAPI de
 *     mensagem exige o ctwa_clid: nao ha o que enviar;
 *  6. o resto → Google, o caminho de sempre (sem conta ou sem dado, o proprio
 *     Google recusa com motivo).
 */

export interface SinaisDoLead {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  ctwa_clid: string | null;
  fbc: string | null;
  evento: string | null;
  utm_source: string | null;
}

export type CanalMeta = 'whatsapp' | 'site';
export type MotivoForaDaMeta = 'formulario' | 'sem_identificador';

export type Destino =
  | { plataforma: 'google' }
  | { plataforma: 'meta'; canal: CanalMeta }
  | { plataforma: 'meta'; fora: MotivoForaDaMeta };

/** Token inteiro, como o `ehDoMeta` antigo: `digital` nao e' `ig`. */
const REDE_META = /^(meta|facebook|instagram|fb|ig)$/i;

export function destinoDoLead(l: SinaisDoLead): Destino {
  if (l.gclid || l.gbraid || l.wbraid) return { plataforma: 'google' };
  if (l.ctwa_clid) return { plataforma: 'meta', canal: 'whatsapp' };
  if (l.evento === 'meta_lead_form') return { plataforma: 'meta', fora: 'formulario' };
  if (l.fbc) return { plataforma: 'meta', canal: 'site' };
  if (REDE_META.test((l.utm_source ?? '').trim())) return { plataforma: 'meta', fora: 'sem_identificador' };
  return { plataforma: 'google' };
}

export const MOTIVO_FORA: Record<MotivoForaDaMeta, string> = {
  formulario: 'formulario nativo da Meta nao envia para a Meta',
  sem_identificador: 'sem ctwa_clid nem fbc, a Meta nao teria como atribuir',
};
```

- [ ] **Passo 4: rodar e ver passar**

Run: `npx vitest run test/domain/plataformaLead.test.ts`
Expected: PASS (7 testes).

- [ ] **Passo 5: commit**

```bash
git add src/domain/plataformaLead.ts test/domain/plataformaLead.test.ts
git commit -m "feat(meta): decisao de plataforma do lead (Google, Meta mensagem, Meta site)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tarefa 9: O corpo do evento para a Conversions API

**Arquivos:**
- Criar: `src/domain/eventoMeta.ts`
- Teste: `test/domain/eventoMeta.test.ts`

**Interfaces:**
- Consome: `hash` de `src/domain/conversao.ts` (SHA-256 hex), `normEmail`, `normFone`, `type CanalMeta` (Tarefa 8).
- Produz:
  - `type EventoMeta = 'LeadSubmitted' | 'Purchase'`;
  - `interface EntradaEventoMeta { canal; evento; eventId; quando (ms); valor; moeda; telefone; email; ctwaClid; pageId; wabaId; fbc; fbp; ip; userAgent; pagina }`;
  - `type EventoCapi = Record<string, unknown>`; `type Montagem = { ok: true; evento: EventoCapi } | { ok: false; erro: string }`;
  - `montarEventoMeta(e): Promise<Montagem>`, `corpoMeta(eventos, codigoDeTeste): { data; test_event_code? }`, `nomeNoCanal(evento, canal): string`, `telefoneMeta(t): string | null`.

- [ ] **Passo 1: escrever o teste que falha**

`test/domain/eventoMeta.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import {
  corpoMeta, montarEventoMeta, nomeNoCanal, telefoneMeta, type EntradaEventoMeta,
} from '../../src/domain/eventoMeta';
import { hash } from '../../src/domain/conversao';
import { normEmail } from '../../src/domain/email';

const QUANDO = Date.parse('2026-09-22T10:00:00Z');

const entrada = (over: Partial<EntradaEventoMeta> = {}): EntradaEventoMeta => ({
  canal: 'whatsapp', evento: 'LeadSubmitted', eventId: 'TAINA-CTWA-9-LeadSubmitted',
  quando: QUANDO, valor: 10, moeda: 'BRL',
  telefone: '+55 (71) 99106-5853', email: 'Maria@Teste.com.br', ctwaClid: 'ARAk-clid',
  pageId: '555', wabaId: null, fbc: null, fbp: null, ip: null, userAgent: null, pagina: null,
  ...over,
});

describe('montarEventoMeta', () => {
  test('mensagem: business_messaging com clid, Pagina e telefone com hash', async () => {
    expect(await montarEventoMeta(entrada())).toEqual({
      ok: true,
      evento: {
        event_name: 'LeadSubmitted',
        event_time: Math.floor(QUANDO / 1000),
        event_id: 'TAINA-CTWA-9-LeadSubmitted',
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: { ph: [await hash('5571991065853')], ctwa_clid: 'ARAk-clid', page_id: '555' },
        custom_data: { value: 10, currency: 'BRL' },
      },
    });
  });

  test('WABA sozinho tambem serve', async () => {
    const r = await montarEventoMeta(entrada({ pageId: null, wabaId: '777' }));
    expect(r.ok && r.evento.user_data).toMatchObject({ whatsapp_business_account_id: '777' });
    expect(r.ok && (r.evento.user_data as Record<string, unknown>).page_id).toBeUndefined();
  });

  test('sem Pagina e sem WABA: nao monta (a Meta responderia 2804116)', async () => {
    const r = await montarEventoMeta(entrada({ pageId: null, wabaId: null }));
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('2804116') });
  });

  test('mensagem sem ctwa_clid: nao monta', async () => {
    const r = await montarEventoMeta(entrada({ ctwaClid: null }));
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('ctwa_clid') });
  });

  test('site: website com fbc, fbp, IP e user agent em claro e e-mail com hash', async () => {
    const r = await montarEventoMeta(entrada({
      canal: 'site', ctwaClid: null, pageId: null,
      fbc: 'fb.1.170.abc', fbp: 'fb.1.170.999', ip: '200.1.2.3', userAgent: 'Mozilla/5.0',
      pagina: 'https://clinica.exemplo/lp',
    }));
    expect(r).toEqual({
      ok: true,
      evento: {
        event_name: 'Lead',
        event_time: Math.floor(QUANDO / 1000),
        event_id: 'TAINA-CTWA-9-LeadSubmitted',
        action_source: 'website',
        event_source_url: 'https://clinica.exemplo/lp',
        user_data: {
          ph: [await hash('5571991065853')],
          em: [await hash(normEmail('Maria@Teste.com.br'))],
          fbc: 'fb.1.170.abc',
          fbp: 'fb.1.170.999',
          client_ip_address: '200.1.2.3',
          client_user_agent: 'Mozilla/5.0',
        },
        custom_data: { value: 10, currency: 'BRL' },
      },
    });
  });

  test('site sem user agent: nao monta (a Meta exige no evento do site)', async () => {
    const r = await montarEventoMeta(entrada({ canal: 'site', ctwaClid: null, fbc: 'fb.1.170.abc' }));
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('user agent') });
  });

  test('sem valor, sem custom_data', async () => {
    const r = await montarEventoMeta(entrada({ valor: null }));
    expect(r.ok && r.evento.custom_data).toBeUndefined();
    const zero = await montarEventoMeta(entrada({ valor: 0 }));
    expect(zero.ok && zero.evento.custom_data).toBeUndefined();
  });
});

describe('nomeNoCanal', () => {
  test('LeadSubmitted vira Lead so no site', () => {
    expect(nomeNoCanal('LeadSubmitted', 'site')).toBe('Lead');
    expect(nomeNoCanal('LeadSubmitted', 'whatsapp')).toBe('LeadSubmitted');
    expect(nomeNoCanal('Purchase', 'site')).toBe('Purchase');
  });
});

describe('corpoMeta', () => {
  test('codigo de teste so quando configurado', () => {
    expect(corpoMeta([{ a: 1 }], 'TEST123')).toEqual({ data: [{ a: 1 }], test_event_code: 'TEST123' });
    expect(corpoMeta([{ a: 1 }], '  ')).toEqual({ data: [{ a: 1 }] });
    expect(corpoMeta([{ a: 1 }], null)).toEqual({ data: [{ a: 1 }] });
  });
});

describe('telefoneMeta', () => {
  test('so digitos, com DDI e o nono digito', () => {
    expect(telefoneMeta('+55 (71) 99106-5853')).toBe('5571991065853');
    expect(telefoneMeta('(71) 9106-5853')).toBe('5571991065853');
    expect(telefoneMeta('123')).toBeNull();
    expect(telefoneMeta(null)).toBeNull();
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run test/domain/eventoMeta.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/domain/eventoMeta"`.

- [ ] **Passo 3: implementar**

`src/domain/eventoMeta.ts`:

```ts
import { hash } from './conversao';
import { normEmail } from './email';
import { normFone } from './phone';
import type { CanalMeta } from './plataformaLead';

/**
 * O evento que sobe para a Conversions API da Meta.
 *
 * Portado de `sendCapíEvent` do whatsapp-track (canal de mensagem, provado em
 * producao: 30 LeadSubmitted aceitos) e estendido ao canal do site.
 *
 * O dado do lead sai daqui so' com hash, como no Google: telefone e e-mail em
 * SHA-256. Fica em claro so' o que a Meta exige assim: ctwa_clid, fbc, fbp, IP
 * e user agent.
 */

export type EventoMeta = 'LeadSubmitted' | 'Purchase';

export interface EntradaEventoMeta {
  canal: CanalMeta;
  evento: EventoMeta;
  /** Protocolo + evento. A Meta deduplica por ele. */
  eventId: string;
  /** Quando aconteceu, em ms. */
  quando: number;
  valor: number | null;
  moeda: string;
  telefone: string | null;
  email: string | null;
  ctwaClid: string | null;
  pageId: string | null;
  wabaId: string | null;
  fbc: string | null;
  fbp: string | null;
  ip: string | null;
  userAgent: string | null;
  pagina: string | null;
}

export type EventoCapi = Record<string, unknown>;
export type Montagem = { ok: true; evento: EventoCapi } | { ok: false; erro: string };

/**
 * `LeadSubmitted` e' o nome em mensagem: la' o pixel "Lead" e' recusado
 * (subcode 2804066). No site vale o nome padrao do pixel, `Lead`.
 */
export function nomeNoCanal(evento: EventoMeta, canal: CanalMeta): string {
  return canal === 'site' && evento === 'LeadSubmitted' ? 'Lead' : evento;
}

/** Telefone para a Meta: so' digitos, com DDI, sem '+'. */
export function telefoneMeta(t: string | null | undefined): string | null {
  const e164 = normFone(t);
  const digitos = e164 ? e164.slice(1) : String(t ?? '').replace(/\D/g, '');
  return digitos.length >= 10 ? digitos : null;
}

export async function montarEventoMeta(e: EntradaEventoMeta): Promise<Montagem> {
  const user: Record<string, unknown> = {};
  const fone = telefoneMeta(e.telefone);
  if (fone) user.ph = [await hash(fone)];

  const ev: EventoCapi = {
    event_name: nomeNoCanal(e.evento, e.canal),
    event_time: Math.floor(e.quando / 1000),
    event_id: e.eventId,
  };

  if (e.canal === 'whatsapp') {
    if (!e.ctwaClid) return { ok: false, erro: 'sem ctwa_clid: a Meta nao atribui evento de mensagem sem ele' };
    if (!e.pageId && !e.wabaId) {
      return { ok: false, erro: 'sem Pagina nem WABA no cadastro da Meta: a Meta recusaria (subcode 2804116)' };
    }
    user.ctwa_clid = e.ctwaClid;
    if (e.pageId) user.page_id = e.pageId;
    if (e.wabaId) user.whatsapp_business_account_id = e.wabaId;
    ev.action_source = 'business_messaging';
    ev.messaging_channel = 'whatsapp';
  } else {
    if (!e.fbc && !e.fbp) return { ok: false, erro: 'sem fbc nem fbp: o evento do site nao teria como ser atribuido' };
    if (!e.userAgent) return { ok: false, erro: 'sem user agent: a Meta exige no evento do site' };
    const email = normEmail(e.email);
    if (email) user.em = [await hash(email)];
    if (e.fbc) user.fbc = e.fbc;
    if (e.fbp) user.fbp = e.fbp;
    if (e.ip) user.client_ip_address = e.ip;
    user.client_user_agent = e.userAgent;
    ev.action_source = 'website';
    if (e.pagina) ev.event_source_url = e.pagina;
  }

  ev.user_data = user;
  if (e.valor !== null && e.valor > 0) ev.custom_data = { value: e.valor, currency: e.moeda };
  return { ok: true, evento: ev };
}

/** O lote pronto para `/{dataset}/events`. Com codigo de teste, nada conta como conversao. */
export function corpoMeta(
  eventos: EventoCapi[],
  codigoDeTeste: string | null,
): { data: EventoCapi[]; test_event_code?: string } {
  const codigo = (codigoDeTeste ?? '').trim();
  return codigo ? { data: eventos, test_event_code: codigo } : { data: eventos };
}
```

- [ ] **Passo 4: rodar e ver passar**

Run: `npx vitest run test/domain/eventoMeta.test.ts && npm run typecheck`
Expected: PASS (10 testes) e typecheck sem erro.

- [ ] **Passo 5: commit**

```bash
git add src/domain/eventoMeta.ts test/domain/eventoMeta.test.ts
git commit -m "feat(meta): corpo do evento da Conversions API por canal

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tarefa 10: Cliente da Conversions API

**Arquivos:**
- Criar: `src/clients/metaCapi.ts`
- Teste: `test/clients/metaCapi.test.ts`

**Interfaces:**
- Produz:
  - `GRAPH_VERSAO = 'v26.0'`;
  - `postarEventos(dataset, token, corpo): Promise<RespostaMeta>` — lança em erro de rede/timeout; qualquer HTTP volta em `RespostaMeta { http: number; corpo: string; eventosRecebidos: number; erro: { code?; error_subcode?; message? } | null }`;
  - `verificarToken(token, dataset, { testEventCode?, pageId?, wabaId? }): Promise<Verificacao>` com `Verificacao { ok: boolean; mensagem: string; datasetNome?: string; rede?: boolean }` (`rede: true` = não deu para falar com a Meta; não diz nada sobre o token).

- [ ] **Passo 1: escrever o teste que falha**

`test/clients/metaCapi.test.ts`:

```ts
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { GRAPH_VERSAO, postarEventos, verificarToken } from '../../src/clients/metaCapi';

let chamadas: Array<{ url: string; metodo: string; auth: string | null; corpo: any }>;
let respostas: Array<() => Response>;

beforeEach(() => {
  chamadas = [];
  respostas = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    chamadas.push({
      url: String(url),
      metodo: init.method ?? 'GET',
      auth: new Headers(init.headers).get('authorization'),
      corpo: init.body ? JSON.parse(String(init.body)) : null,
    });
    const r = respostas.shift();
    if (!r) throw new Error('resposta nao programada no teste');
    return r();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('postarEventos', () => {
  test('posta no dataset, com o token no cabecalho, na versao fixada', async () => {
    respostas.push(() => Response.json({ events_received: 1, fbtrace_id: 'x' }));
    const r = await postarEventos('1234567890', 'tok', { data: [{ event_name: 'LeadSubmitted' }] });
    expect(GRAPH_VERSAO).toBe('v26.0');
    expect(chamadas).toEqual([{
      url: 'https://graph.facebook.com/v26.0/1234567890/events',
      metodo: 'POST',
      auth: 'Bearer tok',
      corpo: { data: [{ event_name: 'LeadSubmitted' }] },
    }]);
    expect(r).toMatchObject({ http: 200, eventosRecebidos: 1, erro: null });
  });

  test('recusa da Meta volta com a mensagem, sem lancar', async () => {
    respostas.push(() => Response.json(
      { error: { message: 'Invalid parameter', code: 100, error_subcode: 2804019 } }, { status: 400 },
    ));
    const r = await postarEventos('1', 'tok', { data: [] });
    expect(r.http).toBe(400);
    expect(r.erro).toEqual({ message: 'Invalid parameter', code: 100, error_subcode: 2804019 });
    expect(r.eventosRecebidos).toBe(0);
  });

  test('rede caida lanca: quem chama deixa a fila retentar', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    await expect(postarEventos('1', 'tok', { data: [] })).rejects.toThrow('fetch failed');
  });
});

describe('verificarToken', () => {
  test('token que le o dataset: ok, com o nome', async () => {
    respostas.push(() => Response.json({ id: '123', name: 'Pixel Tainã' }));
    const r = await verificarToken('tok', '123');
    expect(r).toMatchObject({ ok: true, datasetNome: 'Pixel Tainã' });
    expect(chamadas[0]!.url).toBe('https://graph.facebook.com/v26.0/123?fields=id,name,is_unavailable');
  });

  test('token vencido (190): manda gerar outro', async () => {
    respostas.push(() => Response.json({ error: { code: 190, message: 'expired' } }, { status: 400 }));
    const r = await verificarToken('tok', '123');
    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/inválido ou expirado/);
  });

  test('token da CAPI que nao le o dataset: prova com um evento de teste P12VERIFY', async () => {
    respostas.push(() => Response.json({ error: { code: 100, message: 'Missing Permission' } }, { status: 400 }));
    respostas.push(() => Response.json({ events_received: 1 }));
    const r = await verificarToken('tok', '123', { pageId: '555' });
    expect(r.ok).toBe(true);
    expect(chamadas[1]!.url).toBe('https://graph.facebook.com/v26.0/123/events');
    expect(chamadas[1]!.corpo.test_event_code).toBe('P12VERIFY');
    expect(chamadas[1]!.corpo.data[0].user_data.page_id).toBe('555');
  });

  test('sem Pagina nem WABA nao da para provar por envio', async () => {
    respostas.push(() => Response.json({ error: { code: 100, message: 'Missing Permission' } }, { status: 400 }));
    const r = await verificarToken('tok', '123');
    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/Página/);
    expect(chamadas).toHaveLength(1);
  });

  test('sem dataset nem chama a Meta', async () => {
    const r = await verificarToken('tok', null);
    expect(r.ok).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  test('Meta fora do ar: marca que foi a rede, nao o token', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    expect(await verificarToken('tok', '123')).toMatchObject({ ok: false, rede: true });
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run test/clients/metaCapi.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/clients/metaCapi"`.

- [ ] **Passo 3: implementar**

`src/clients/metaCapi.ts`:

```ts
/**
 * Conversions API da Meta: envio de eventos e verificacao do token.
 *
 * A versao da Graph API fica aqui, num lugar so'. Conferida no changelog em
 * 22/09/2026: v26.0 (29/07/2026) e' a mais recente. A Meta promove sozinha a
 * versao vencida, mas subir de versao e' decisao de quem leu o changelog.
 */
export const GRAPH_VERSAO = 'v26.0';

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSAO}`;
const TEMPO_MS = 20_000;

export interface RespostaMeta {
  http: number;
  /** Corpo cru da resposta, cortado: vai para o log do evento. */
  corpo: string;
  eventosRecebidos: number;
  erro: { code?: number; error_subcode?: number; message?: string } | null;
}

/**
 * Posta os eventos. Erro de rede e timeout LANCAM: a fila retenta. Resposta
 * HTTP de qualquer codigo volta para quem chamou decidir.
 */
export async function postarEventos(dataset: string, token: string, corpo: unknown): Promise<RespostaMeta> {
  const r = await fetch(`${GRAPH}/${encodeURIComponent(dataset)}/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(TEMPO_MS),
  });
  const texto = await r.text();
  let j: { events_received?: number; error?: RespostaMeta['erro'] } = {};
  try {
    j = JSON.parse(texto) as typeof j;
  } catch {
    /* corpo nao-json: fica o texto */
  }
  return {
    http: r.status,
    corpo: texto.slice(0, 4000),
    eventosRecebidos: Number(j.events_received ?? 0),
    erro: j.error ?? null,
  };
}

export interface Verificacao {
  ok: boolean;
  /** Frase pronta para a tela: nunca a mensagem crua da Meta. */
  mensagem: string;
  datasetNome?: string;
  /** Nao deu para falar com a Meta: o resultado nao diz nada sobre o token. */
  rede?: boolean;
}

export interface OpcoesVerificacao {
  testEventCode?: string | null;
  pageId?: string | null;
  wabaId?: string | null;
}

const SEM_REDE: Verificacao = { ok: false, rede: true, mensagem: 'Não foi possível falar com a Meta agora. Tente de novo.' };
const TOKEN_INVALIDO: Verificacao = { ok: false, mensagem: 'Token inválido ou expirado. Gere outro no Gerenciador de Eventos.' };

/** Hash de um telefone qualquer, so' para a Meta aceitar o evento de teste. */
const TELEFONE_DE_TESTE = '035c58ae9ea0e452d658fcef6e0ca4dae521f6dcd8f8260a083301ac4811bc25';

/**
 * O token alcanca o dataset? Port de `verificarTokenDoCliente` do tracker.
 *
 * Token da CAPI costuma poder ENVIAR sem poder LER o dataset (a Meta responde
 * code 100/200/10 no GET). Nesse caso prova enviando um evento com codigo de
 * teste, que so' aparece em "Testar eventos" e nao conta como conversao.
 */
export async function verificarToken(
  token: string,
  dataset: string | null,
  o: OpcoesVerificacao = {},
): Promise<Verificacao> {
  if (!dataset) return { ok: false, mensagem: 'Preencha o dataset antes de verificar.' };

  let r: Response;
  try {
    r = await fetch(`${GRAPH}/${encodeURIComponent(dataset)}?fields=id,name,is_unavailable`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TEMPO_MS),
    });
  } catch {
    return SEM_REDE;
  }
  const j = (await r.json().catch(() => ({}))) as { name?: string; is_unavailable?: boolean; error?: { code?: number } };

  if (r.ok && !j.error) {
    if (j.is_unavailable) return { ok: false, mensagem: 'A Meta marcou este dataset como indisponível.', datasetNome: j.name };
    return { ok: true, mensagem: `Token válido e com acesso a "${j.name ?? dataset}".`, datasetNome: j.name };
  }

  const code = j.error?.code;
  if (code === 190) return TOKEN_INVALIDO;
  if (code === 100 || code === 200 || code === 10) return verificarPorEnvio(token, dataset, o);
  return { ok: false, mensagem: 'A Meta recusou a verificação. Confira o token e o dataset.' };
}

async function verificarPorEnvio(token: string, dataset: string, o: OpcoesVerificacao): Promise<Verificacao> {
  if (!o.pageId && !o.wabaId) {
    return {
      ok: false,
      mensagem: 'O token não lê o dataset (normal em token da CAPI). Preencha a Página ou o WABA e verifique ' +
        'de novo: a verificação envia um evento de teste.',
    };
  }

  const codigo = (o.testEventCode ?? '').trim() || 'P12VERIFY';
  const user: Record<string, unknown> = { ph: [TELEFONE_DE_TESTE] };
  if (o.pageId) user.page_id = o.pageId;
  if (o.wabaId) user.whatsapp_business_account_id = o.wabaId;

  let r: RespostaMeta;
  try {
    r = await postarEventos(dataset, token, {
      data: [{
        event_name: 'LeadSubmitted',
        event_time: Math.floor(Date.now() / 1000) - 30,
        event_id: `p12-verify-${crypto.randomUUID()}`,
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: user,
      }],
      test_event_code: codigo,
    });
  } catch {
    return SEM_REDE;
  }

  if (r.http === 200 && r.eventosRecebidos >= 1) {
    return { ok: true, mensagem: `Token válido para enviar neste dataset (conferido com o evento de teste ${codigo}).` };
  }
  if (r.erro?.code === 190) return TOKEN_INVALIDO;
  if (r.erro?.error_subcode === 2804116) {
    return { ok: false, mensagem: 'Falta Página ou WABA válido para a Meta aceitar o evento de teste.' };
  }
  return {
    ok: false,
    mensagem: 'O token não conseguiu enviar neste dataset. Confira se ele foi gerado neste dataset, no Gerenciador de Eventos.',
  };
}
```

- [ ] **Passo 4: rodar e ver passar**

Run: `npx vitest run test/clients/metaCapi.test.ts && npm run typecheck`
Expected: PASS (9 testes) e typecheck sem erro.

- [ ] **Passo 5: commit**

```bash
git add src/clients/metaCapi.ts test/clients/metaCapi.test.ts
git commit -m "feat(meta): cliente da Conversions API (envio e verificacao do token)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tarefa 11: Consumidor do envio à Meta

**Arquivos:**
- Criar: `src/pipelines/metaCapi.ts`
- Modificar: `src/queue/consumer.ts`
- Teste: `test/pipelines/metaCapi.test.ts`

**Interfaces:**
- Consome: `decifrarToken` (Tarefa 7), `montarEventoMeta`, `corpoMeta`, `type EventoMeta` (Tarefa 9), `postarEventos` (Tarefa 10), `registrarEvento` de `src/db/queries.ts`, `exigir` de `src/domain/config.ts`.
- Produz:
  - `interface ResultadoMeta { status: 'ok' | 'ignorado' | 'erro'; motivo: string; retentar?: boolean }`;
  - `enfileirarEventoMeta(env, tenantId, metaEventoId, dedupeKey): Promise<void>` — grava uma linha em `events` (`source 'kanban'`, `event_type 'meta_capi'`, payload `{"meta_evento_id":N,"dedupe_key":"..."}`) e manda `{ eventId, tenantId, source: 'kanban', eventType: 'meta_capi' }` para a fila;
  - `enviarEventoMeta(env, tenantId, payload): Promise<ResultadoMeta>`;
  - `reenviarFalhasMeta(env, tenantId): Promise<{ na_fila: number }>`.
  - Regras de resultado: dry-run → `ok` e linha `nao_enviado`, sem rede; HTTP 200 com `events_received ≥ 1` → `ok` e `enviado`; 4xx ou 200 sem evento aceito → `erro` com `retentar: false`; 5xx ou rede → `erro` sem `retentar` (a fila retenta).

- [ ] **Passo 1: escrever o teste que falha**

`test/pipelines/metaCapi.test.ts`:

```ts
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { enviarEventoMeta, reenviarFalhasMeta } from '../../src/pipelines/metaCapi';
import { cifrarToken } from '../../src/domain/segredoMeta';
import { hash } from '../../src/domain/conversao';
import type { Env } from '../../src/env';

const MK = 'chave-mestra-de-teste';
const sql = (v: string | null) => (v === null ? 'NULL' : `'${v}'`);

async function cenario(over: { dryRun?: number; pageId?: string | null; testCode?: string | null; eventAt?: string } = {}) {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
  const { cipher, iv } = await cifrarToken('EAAB-token-da-taina', MK);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key,
          meta_dataset_id, meta_page_id, meta_test_event_code, meta_token_cipher, meta_token_iv, meta_dry_run)
        VALUES (5, 3, 9, 'k', '1234567890', ${sql(over.pageId === undefined ? '555' : over.pageId)},
                ${sql(over.testCode ?? null)}, '${cipher}', '${iv}', ${over.dryRun ?? 0})`);
  exec(`INSERT INTO leads (tenant_id, protocol, phone_e164, phone_key, utm_source, ctwa_clid, evento)
        VALUES (5, 'TAINA-CTWA-9', '+5571991065853', '7191065853', 'facebook', 'ARAk-clid', 'anuncio_meta')`);
  const quando = over.eventAt ?? new Date(Date.now() - 3_600_000).toISOString();
  exec(`INSERT INTO meta_eventos (id, tenant_id, dedupe_key, event_id, protocol, phone_key, canal, event_name,
          etapa, value, currency, event_at)
        VALUES (1, 5, 'TAINA-CTWA-9-LeadSubmitted', 'TAINA-CTWA-9-LeadSubmitted', 'TAINA-CTWA-9', '7191065853',
                'whatsapp', 'LeadSubmitted', 'Novo Lead', 10, 'BRL', '${quando}')`);
  const fila: Array<Record<string, unknown>> = [];
  const env = {
    DB: d1, MASTER_KEY: MK,
    QUEUE: { send: async (m: Record<string, unknown>) => { fila.push(m); } },
  } as unknown as Env;
  return { env, exec, consultar, fila };
}

const PAYLOAD = JSON.stringify({ meta_evento_id: 1, dedupe_key: 'TAINA-CTWA-9-LeadSubmitted' });
const linha = (consultar: <T>(q: string) => T[]) =>
  consultar<Record<string, any>>('SELECT * FROM meta_eventos WHERE id = 1')[0]!;

let chamadas: Array<{ url: string; auth: string | null; corpo: any }>;
let resposta: () => Response;

beforeEach(() => {
  chamadas = [];
  resposta = () => Response.json({ events_received: 1, fbtrace_id: 'abc' });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    chamadas.push({
      url: String(url),
      auth: new Headers(init.headers).get('authorization'),
      corpo: init.body ? JSON.parse(String(init.body)) : null,
    });
    return resposta();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('enviarEventoMeta', () => {
  test('envia o LeadSubmitted de mensagem com o clique, a Pagina e o telefone com hash', async () => {
    const { env, consultar } = await cenario();
    const r = await enviarEventoMeta(env, 5, PAYLOAD);

    expect(r.status).toBe('ok');
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toBe('https://graph.facebook.com/v26.0/1234567890/events');
    expect(chamadas[0]!.auth).toBe('Bearer EAAB-token-da-taina');
    expect(chamadas[0]!.corpo.data[0]).toMatchObject({
      event_name: 'LeadSubmitted',
      event_id: 'TAINA-CTWA-9-LeadSubmitted',
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: { ph: [await hash('5571991065853')], ctwa_clid: 'ARAk-clid', page_id: '555' },
      custom_data: { value: 10, currency: 'BRL' },
    });
    expect(chamadas[0]!.corpo.test_event_code).toBeUndefined();

    const l = linha(consultar);
    expect(l).toMatchObject({ status: 'enviado', http_code: 200, tentativas: 1 });
    expect(l.sent_at).not.toBeNull();
    expect(consultar('SELECT meta_token_valido FROM tenant_config')).toEqual([{ meta_token_valido: 1 }]);
  });

  test('envio desligado: monta, guarda e nao chama a Meta', async () => {
    const { env, consultar } = await cenario({ dryRun: 1 });
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r.status).toBe('ok');
    expect(chamadas).toHaveLength(0);
    const l = linha(consultar);
    expect(l.status).toBe('nao_enviado');
    expect(l.request_payload).toContain('ARAk-clid');
    expect(l.request_payload).not.toContain('5571991065853');
  });

  test('4xx: falhou e nao volta para a fila', async () => {
    const { env, consultar } = await cenario();
    resposta = () => Response.json(
      { error: { message: 'Invalid parameter', code: 100, error_subcode: 2804019 } }, { status: 400 },
    );
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r).toMatchObject({ status: 'erro', retentar: false });
    expect(r.motivo).toMatch(/^TAINA-CTWA-9-LeadSubmitted: Meta recusou/);
    expect(linha(consultar)).toMatchObject({ status: 'falhou', http_code: 400 });
    expect(linha(consultar).erro).toContain('Invalid parameter');
  });

  test('5xx: falhou e a fila retenta', async () => {
    const { env, consultar } = await cenario();
    resposta = () => new Response('indisponivel', { status: 503 });
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r.status).toBe('erro');
    expect(r.retentar).toBeUndefined();
    expect(linha(consultar).status).toBe('falhou');
  });

  test('rede caiu: a fila retenta', async () => {
    const { env, consultar } = await cenario();
    resposta = () => { throw new TypeError('fetch failed'); };
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r.status).toBe('erro');
    expect(r.retentar).toBeUndefined();
    expect(linha(consultar).erro).toContain('fetch failed');
  });

  test('sem Pagina e sem WABA: falha antes da rede', async () => {
    const { env, consultar } = await cenario({ pageId: null });
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r).toMatchObject({ status: 'erro', retentar: false });
    expect(chamadas).toHaveLength(0);
    expect(linha(consultar).erro).toContain('2804116');
  });

  test('evento com mais de 7 dias: falha sem chamar a Meta', async () => {
    const { env } = await cenario({ eventAt: new Date(Date.now() - 8 * 86_400_000).toISOString() });
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r).toMatchObject({ status: 'erro', retentar: false });
    expect(r.motivo).toContain('7 dias');
    expect(chamadas).toHaveLength(0);
  });

  test('codigo de teste vai no corpo', async () => {
    const { env } = await cenario({ testCode: 'TEST123' });
    await enviarEventoMeta(env, 5, PAYLOAD);
    expect(chamadas[0]!.corpo.test_event_code).toBe('TEST123');
  });

  test('ja enviado nao sai de novo', async () => {
    const { env, exec } = await cenario();
    exec(`UPDATE meta_eventos SET status = 'enviado' WHERE id = 1`);
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r.status).toBe('ignorado');
    expect(chamadas).toHaveLength(0);
  });

  test('subiu: os erros anteriores deste evento saem das notificacoes', async () => {
    const { env, exec, consultar } = await cenario();
    exec(`INSERT INTO events (tenant_id, source, event_type, payload, status, motivo)
          VALUES (5, 'kanban', 'meta_capi', '{}', 'erro', 'TAINA-CTWA-9-LeadSubmitted: Meta nao respondeu: timeout')`);
    await enviarEventoMeta(env, 5, PAYLOAD);
    const [e] = consultar<{ resolvido_em: string | null }>(`SELECT resolvido_em FROM events WHERE event_type = 'meta_capi'`);
    expect(e!.resolvido_em).not.toBeNull();
  });
});

describe('reenviarFalhasMeta', () => {
  test('volta para a fila so o que falhou e e do CRM', async () => {
    const { env, exec, consultar, fila } = await cenario();
    exec(`UPDATE meta_eventos SET status = 'falhou' WHERE id = 1`);
    exec(`INSERT INTO meta_eventos (id, tenant_id, dedupe_key, event_id, canal, event_name, status, origem, event_at)
          VALUES (2, 5, 'trk-1', 'trk-1', 'whatsapp', 'LeadSubmitted', 'falhou', 'tracker', '2026-09-01T10:00:00Z'),
                 (3, 5, 'X-Purchase', 'X-Purchase', 'whatsapp', 'Purchase', 'enviado', 'crm', '2026-09-01T10:00:00Z')`);

    expect(await reenviarFalhasMeta(env, 5)).toEqual({ na_fila: 1 });
    expect(fila).toEqual([expect.objectContaining({ tenantId: 5, source: 'kanban', eventType: 'meta_capi' })]);
    expect(consultar('SELECT id, status FROM meta_eventos ORDER BY id')).toEqual([
      { id: 1, status: 'pendente' },
      { id: 2, status: 'falhou' },
      { id: 3, status: 'enviado' },
    ]);
    const [ev] = consultar<{ payload: string }>(`SELECT payload FROM events WHERE event_type = 'meta_capi'`);
    expect(JSON.parse(ev!.payload)).toEqual({ meta_evento_id: 1, dedupe_key: 'TAINA-CTWA-9-LeadSubmitted' });
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run test/pipelines/metaCapi.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/pipelines/metaCapi"`.

- [ ] **Passo 3: implementar**

`src/pipelines/metaCapi.ts`:

```ts
import type { Env } from '../env';
import { exigir } from '../domain/config';
import { decifrarToken } from '../domain/segredoMeta';
import { corpoMeta, montarEventoMeta, type EventoMeta } from '../domain/eventoMeta';
import type { CanalMeta } from '../domain/plataformaLead';
import { postarEventos, type RespostaMeta } from '../clients/metaCapi';
import { registrarEvento } from '../db/queries';

/**
 * Conversoes da Meta: do evento criado pela etapa do funil ate' a Conversions API.
 *
 * Cada envio e' uma execucao propria da fila (`kanban` / `meta_capi`). A
 * conversao do Google ja' gasta ~15 subrequests por execucao (ver o
 * `max_batch_size` no wrangler.jsonc); a Meta nao pode disputar esse teto.
 *
 * A linha em `meta_eventos` nasce antes da rede, como a de `conversions`: se a
 * Meta cair no meio fica o registro do que foi tentado, e a retentativa acha a
 * linha em `falhou` e reenvia em vez de achar que ja' subiu.
 */

export interface ResultadoMeta {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
  /** false = erro do dado ou do cadastro: retentar nao muda nada. */
  retentar?: boolean;
}

/** A Meta recusa evento com mais de 7 dias. */
const IDADE_MAXIMA_MS = 7 * 24 * 3600 * 1000;

interface LinhaEvento {
  id: number;
  dedupe_key: string;
  event_id: string;
  protocol: string | null;
  canal: CanalMeta;
  event_name: EventoMeta;
  value: number | null;
  currency: string | null;
  status: string;
  event_at: string;
}

interface ConfigMeta {
  meta_dataset_id: string | null;
  meta_page_id: string | null;
  meta_waba_id: string | null;
  meta_test_event_code: string | null;
  meta_token_cipher: string | null;
  meta_token_iv: string | null;
  meta_dry_run: number;
}

interface LeadMeta {
  phone_e164: string | null;
  email: string | null;
  ctwa_clid: string | null;
  fbc: string | null;
  fbp: string | null;
  ip_address: string | null;
  user_agent: string | null;
  page_url: string | null;
}

/**
 * Enfileira o envio de um evento ja' gravado em `meta_eventos`.
 *
 * A linha em `events` e' o que viaja na fila (o consumidor le' o payload de
 * la') e e' o que faz uma falha aparecer em Atividade e nas notificacoes.
 */
export async function enfileirarEventoMeta(
  env: Env,
  tenantId: number,
  metaEventoId: number,
  dedupeKey: string,
): Promise<void> {
  const eventId = await registrarEvento(env.DB, {
    tenantId,
    source: 'kanban',
    eventType: 'meta_capi',
    payload: JSON.stringify({ meta_evento_id: metaEventoId, dedupe_key: dedupeKey }),
    signatureOk: null,
  });
  await env.QUEUE.send({ eventId, tenantId, source: 'kanban', eventType: 'meta_capi' });
}

export async function enviarEventoMeta(env: Env, tenantId: number, payload: string): Promise<ResultadoMeta> {
  let id = NaN;
  try {
    id = Number((JSON.parse(payload) as { meta_evento_id?: unknown }).meta_evento_id);
  } catch {
    /* fica NaN */
  }
  if (!Number.isInteger(id)) return { status: 'ignorado', motivo: 'payload sem meta_evento_id' };

  const ev = await env.DB.prepare(
    `SELECT id, dedupe_key, event_id, protocol, canal, event_name, value, currency, status, event_at
     FROM meta_eventos WHERE id = ? AND tenant_id = ?`,
  )
    .bind(id, tenantId)
    .first<LinhaEvento>();
  if (!ev) return { status: 'ignorado', motivo: `evento da Meta ${id} nao existe mais` };
  if (ev.status === 'enviado') return { status: 'ignorado', motivo: `${ev.dedupe_key} ja enviado a Meta` };

  const cfg = await env.DB.prepare(
    `SELECT meta_dataset_id, meta_page_id, meta_waba_id, meta_test_event_code,
            meta_token_cipher, meta_token_iv, meta_dry_run
     FROM tenant_config WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<ConfigMeta>();
  if (!cfg?.meta_dataset_id) return falhar(env, ev, 'cliente sem dataset da Meta no cadastro');

  const lead = ev.protocol
    ? await env.DB.prepare(
        `SELECT phone_e164, email, ctwa_clid, fbc, fbp, ip_address, user_agent, page_url
         FROM leads WHERE tenant_id = ? AND protocol = ?`,
      )
        .bind(tenantId, ev.protocol)
        .first<LeadMeta>()
    : null;
  if (!lead) return falhar(env, ev, `lead ${ev.protocol ?? '(sem protocolo)'} nao esta em leads`);

  const quando = Date.parse(ev.event_at);
  const montado = await montarEventoMeta({
    canal: ev.canal,
    evento: ev.event_name,
    eventId: ev.event_id,
    quando,
    valor: ev.value,
    moeda: ev.currency ?? 'BRL',
    telefone: lead.phone_e164,
    email: lead.email,
    ctwaClid: lead.ctwa_clid,
    pageId: cfg.meta_page_id,
    wabaId: cfg.meta_waba_id,
    fbc: lead.fbc,
    fbp: lead.fbp,
    ip: lead.ip_address,
    userAgent: lead.user_agent,
    pagina: lead.page_url,
  });
  if (!montado.ok) return falhar(env, ev, montado.erro);

  const corpo = corpoMeta([montado.evento], cfg.meta_test_event_code);
  const pedido = JSON.stringify(corpo);

  // Envio desligado: monta e guarda, nao chama a Meta. O `nao_enviado` volta a
  // valer quando o envio for ligado e a etapa disparar de novo.
  if (cfg.meta_dry_run === 1) {
    await env.DB.prepare(`UPDATE meta_eventos SET status = 'nao_enviado', request_payload = ?, erro = NULL WHERE id = ?`)
      .bind(pedido, ev.id)
      .run();
    return { status: 'ok', motivo: `${ev.dedupe_key}: envio a Meta desligado, montado e guardado sem enviar` };
  }

  if (!Number.isFinite(quando) || Date.now() - quando > IDADE_MAXIMA_MS) {
    return falhar(env, ev, 'evento com mais de 7 dias: a Meta recusa', pedido);
  }
  if (!cfg.meta_token_cipher || !cfg.meta_token_iv) return falhar(env, ev, 'sem token da Meta no cadastro', pedido);

  let token: string;
  try {
    token = await decifrarToken(cfg.meta_token_cipher, cfg.meta_token_iv, exigir(env, 'MASTER_KEY'));
  } catch (e) {
    return falhar(env, ev, `token da Meta nao abriu (a MASTER_KEY confere?): ${(e as Error).message.slice(0, 120)}`, pedido);
  }

  let r: RespostaMeta;
  try {
    r = await postarEventos(cfg.meta_dataset_id, token, corpo);
  } catch (e) {
    // rede ou timeout: a fila retenta e acha a linha em 'falhou'
    const erro = `Meta nao respondeu: ${(e as Error).message.slice(0, 200)}`;
    await gravar(env, ev.id, 'falhou', { erro, pedido });
    return { status: 'erro', motivo: `${ev.dedupe_key}: ${erro}` };
  }

  if (r.http === 200 && r.eventosRecebidos >= 1) {
    await gravar(env, ev.id, 'enviado', { http: r.http, resposta: r.corpo, pedido });
    // envio aceito prova o token: o selo nao fica preso em "nao verificado"
    await env.DB.prepare(
      `UPDATE tenant_config SET meta_token_valido = 1,
         meta_token_conferido_em = COALESCE(meta_token_conferido_em, datetime('now'))
       WHERE tenant_id = ?`,
    )
      .bind(tenantId)
      .run();
    await resolverErrosAnteriores(env, tenantId, ev);
    return {
      status: 'ok',
      motivo:
        `${ev.dedupe_key} → Meta ${String(montado.evento.event_name)} (${ev.canal})` +
        (ev.value ? ` · ${ev.currency ?? 'BRL'} ${ev.value}` : '') +
        (cfg.meta_test_event_code ? ' · codigo de teste (nao conta como conversao)' : ''),
    };
  }

  const detalhe = r.erro?.message ?? (r.http === 200 ? 'nenhum evento aceito' : r.corpo.slice(0, 120));
  const erro = `Meta recusou (${r.http}${r.erro?.error_subcode ? '/' + r.erro.error_subcode : ''}): ${detalhe}`.slice(0, 300);
  await gravar(env, ev.id, 'falhou', { http: r.http, resposta: r.corpo, erro, pedido });
  // 5xx e' da Meta e passa; 4xx (e 200 sem evento aceito) e' do dado e nao passa sozinho
  if (r.http >= 500) return { status: 'erro', motivo: `${ev.dedupe_key}: ${erro}` };
  return { status: 'erro', motivo: `${ev.dedupe_key}: ${erro}`, retentar: false };
}

/** Reenfileira os eventos que falharam. `enviado` nunca volta: contaria duas vezes. */
export async function reenviarFalhasMeta(env: Env, tenantId: number): Promise<{ na_fila: number }> {
  const { results } = await env.DB.prepare(
    `SELECT id, dedupe_key FROM meta_eventos
     WHERE tenant_id = ? AND status = 'falhou' AND origem = 'crm' ORDER BY id LIMIT 50`,
  )
    .bind(tenantId)
    .all<{ id: number; dedupe_key: string }>();
  for (const e of results) {
    await env.DB.prepare(`UPDATE meta_eventos SET status = 'pendente' WHERE id = ?`).bind(e.id).run();
    await enfileirarEventoMeta(env, tenantId, e.id, e.dedupe_key);
  }
  return { na_fila: results.length };
}

async function falhar(env: Env, ev: LinhaEvento, erro: string, pedido?: string): Promise<ResultadoMeta> {
  await gravar(env, ev.id, 'falhou', { erro, pedido });
  return { status: 'erro', motivo: `${ev.dedupe_key}: ${erro}`, retentar: false };
}

async function gravar(
  env: Env,
  id: number,
  status: 'enviado' | 'falhou',
  d: { http?: number; resposta?: string; erro?: string; pedido?: string },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE meta_eventos
     SET status = ?, http_code = ?, response_body = ?, erro = ?,
         request_payload = COALESCE(?, request_payload), tentativas = tentativas + 1,
         sent_at = CASE WHEN ? = 'enviado' THEN datetime('now') ELSE sent_at END
     WHERE id = ?`,
  )
    .bind(status, d.http ?? null, d.resposta ?? null, d.erro ?? null, d.pedido ?? null, status, id)
    .run();
}

/**
 * Subiu: os erros que este evento deixou no log ja' nao sao noticia. A venda
 * que subiu tambem resolve o "sem valor da venda" do mesmo protocolo.
 */
async function resolverErrosAnteriores(env: Env, tenantId: number, ev: LinhaEvento): Promise<void> {
  const semValor = ev.event_name === 'Purchase' && ev.protocol ? `${ev.protocol}: %evento da Meta%` : null;
  await env.DB.prepare(
    `UPDATE events SET resolvido_em = datetime('now'), resolvido_por = 'sistema: o evento subiu para a Meta'
     WHERE tenant_id = ? AND status = 'erro' AND resolvido_em IS NULL
       AND ((event_type = 'meta_capi' AND motivo LIKE ?)
         OR (? IS NOT NULL AND event_type = 'kanban_conversao' AND motivo LIKE ?))`,
  )
    .bind(tenantId, ev.dedupe_key + ':%', semValor, semValor)
    .run()
    .catch(() => undefined);
}
```

- [ ] **Passo 4: ligar no consumidor**

Em `src/queue/consumer.ts`, import:

```ts
import { enviarEventoMeta } from '../pipelines/metaCapi';
```

e, no `case 'kanban':`, entre o `if (msg.eventType === 'kanban_conversao') {...}` e o `return avisarLeadNoGrupo(...)`:

```ts
      // Envio a Meta: criado pela etapa do funil, uma execucao por evento
      if (msg.eventType === 'meta_capi') {
        return enviarEventoMeta(env, msg.tenantId, payload);
      }
```

- [ ] **Passo 5: rodar e ver passar**

Run: `npx vitest run test/pipelines/metaCapi.test.ts && npm test && npm run typecheck`
Expected: PASS (11 testes novos; suíte verde; typecheck sem erro).

- [ ] **Passo 6: commit**

```bash
git add src/pipelines/metaCapi.ts src/queue/consumer.ts test/pipelines/metaCapi.test.ts
git commit -m "feat(meta): consumidor que envia o evento a Conversions API

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Tarefas 12–18 (resumo; detalhe na spec)

- **12. stageChanged bifurca:** `src/db/metaAtribuicoes.ts` (`clidRecente`, 7 dias); `criarEventoMeta` em `src/pipelines/metaCapi.ts` (destino, clique tardio, etapa sem evento, sem dataset, Purchase sem valor, trava do tracker, `INSERT OR IGNORE meta_eventos`, enfileira). `enviarConversao` carrega `meta_evento` e o lead completo e desvia lead Meta para `criarEventoMeta`; lead Google igual a hoje (testes atuais verdes).
- **13. leadMessage:** clique da Evolution no passo 2 (`TAINA-CTWA-<conversa>` com `ctwa_clid`); espera de 20 s uma vez para anúncio/frase Meta sem clique, só com chave `evolution`; etapa de entrada pela plataforma (`meta_evento` para lead Meta); consumidor passa `tentativa`.
- **14. Cadastro da Meta:** `src/pipelines/metaConfig.ts` + rotas `GET/PUT /meta`, `POST /meta/verificar`, `GET/PUT /meta/etapas`, `GET /meta/eventos`, `POST /meta/eventos/reenviar`. Token só entra, nunca sai.
- **15. Expurgo e notificações:** `meta_eventos` com 30 dias perde `request_payload`/`response_body`; `meta_capi` → notificação "Evento não subiu para a Meta Ads" em `meta/eventos`.
- **16. Painel:** seções Conexão (campos, verificar, interruptor), Eventos por etapa, Eventos enviados; selo "Meta Ads" no topo.
- **17. Importação da Tainã:** `src/domain/importTracker.ts` (puro, testado) + `scripts/importar-tracker.mjs` (API do D1; nada gravado em arquivo).
- **18. Virada:** migração remota → push → `MASTER_KEY` → importação → etapas → verificar token → ligar envio → Conectar "Tainã Aci" → conferir 1º envio; volta atrás = Restaurar anterior.
