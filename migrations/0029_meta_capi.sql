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
