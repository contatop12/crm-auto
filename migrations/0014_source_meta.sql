-- `source` ganha 'meta': o formulario nativo do Meta e' de fato uma origem
-- nova, nao um clique nem um webhook do Chatwoot.
--
-- A tentacao era reaproveitar 'click' e deixar o `event_type` distinguir. Seria
-- mentira no dado — formulario preenchido dentro do Meta nao e' clique — e a
-- primeira consulta que agrupasse por origem daria numero errado.
--
-- SQLite nao altera CHECK, entao a tabela e' reconstruida. `events` e' a mais
-- movimentada do banco; a copia e' rapida (milhares de linhas, nao milhoes),
-- mas se um webhook chegar exatamente no meio da troca ele se perde. O GTM e o
-- Chatwoot reenviam; o risco e' de segundos e a alternativa era carregar um
-- dado errado para sempre.
PRAGMA foreign_keys = OFF;

CREATE TABLE events_nova (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  source        TEXT    NOT NULL CHECK (source IN ('click','chatwoot','kanban','meta')),
  event_type    TEXT,
  payload       TEXT NOT NULL,
  signature_ok  INTEGER,
  status        TEXT    NOT NULL DEFAULT 'recebido'
                CHECK (status IN ('recebido','processando','ok','ignorado','erro')),
  motivo        TEXT,
  tentativas    INTEGER NOT NULL DEFAULT 0,
  received_at   TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at  TEXT
);

INSERT INTO events_nova
  (id, tenant_id, source, event_type, payload, signature_ok, status, motivo, tentativas, received_at, processed_at)
SELECT id, tenant_id, source, event_type, payload, signature_ok, status, motivo, tentativas, received_at, processed_at
  FROM events;

DROP TABLE events;
ALTER TABLE events_nova RENAME TO events;

-- mesmos nomes e mesma ordem do 0001, senao o proximo que ler o schema
-- encontra indices diferentes dos que a migracao original criou
CREATE INDEX idx_events_tenant_time ON events(tenant_id, received_at DESC);
CREATE INDEX idx_events_status ON events(status, received_at DESC);

PRAGMA foreign_keys = ON;
