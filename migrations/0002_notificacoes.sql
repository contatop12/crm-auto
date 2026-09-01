-- Aviso de lead novo no grupo do cliente (via Pulseboard).
--
-- A trava de duplicata e' a razao desta tabela existir: o webhook do Kanban
-- dispara em QUALQUER alteracao da task, e um card que sai e volta do board de
-- Ads geraria uma mensagem nova no grupo a cada vez.
--
-- A chave prefere o protocolo, que e' estavel e sobrevive ao card ser recriado.
-- Sem protocolo, cai para o id da task.
CREATE TABLE group_notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chave       TEXT    NOT NULL,   -- protocolo, ou 'task:<id>' quando nao houver
  task_id     INTEGER,
  protocolo   TEXT,
  canal       TEXT,               -- 'Campanha de Quiz - Google'
  lead_nome   TEXT,
  telefone    TEXT,
  status      TEXT    NOT NULL DEFAULT 'pendente'
              CHECK (status IN ('pendente','enviado','erro')),
  erro        TEXT,
  enviado_em  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, chave)
);
CREATE INDEX idx_group_notifications_tenant ON group_notifications(tenant_id, created_at DESC);
