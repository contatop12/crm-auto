-- Faltava um estado: o aviso que nao saiu porque o cliente nao usa o aviso.
--
-- Antes so' havia 'pendente', 'enviado' e 'erro'. Registrar isso como 'erro'
-- pintaria de vermelho um cliente que esta' exatamente como foi configurado; e
-- deixar em 'pendente' mentiria que ainda vai sair.
--
-- SQLite nao altera CHECK, entao a tabela e' reconstruida. Sem `id` na copia
-- para o AUTOINCREMENT continuar de onde estava.
PRAGMA foreign_keys = OFF;

CREATE TABLE group_notifications_nova (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chave       TEXT    NOT NULL,   -- protocolo, ou 'task:<id>' quando nao houver
  task_id     INTEGER,
  protocolo   TEXT,
  canal       TEXT,               -- 'Campanha de Quiz - Google'
  lead_nome   TEXT,
  telefone    TEXT,
  status      TEXT    NOT NULL DEFAULT 'pendente'
              CHECK (status IN ('pendente','enviado','erro','ignorado')),
  erro        TEXT,
  enviado_em  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, chave)
);

INSERT INTO group_notifications_nova
  (id, tenant_id, chave, task_id, protocolo, canal, lead_nome, telefone, status, erro, enviado_em, created_at)
SELECT id, tenant_id, chave, task_id, protocolo, canal, lead_nome, telefone, status, erro, enviado_em, created_at
  FROM group_notifications;

DROP TABLE group_notifications;
ALTER TABLE group_notifications_nova RENAME TO group_notifications;
CREATE INDEX idx_group_notifications_tenant ON group_notifications(tenant_id, created_at DESC);

PRAGMA foreign_keys = ON;
