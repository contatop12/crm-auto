-- A instancia do WhatsApp e' por INBOX, nao por cliente.
--
-- A Locadora Exatidao roda tres numeros, cada um com sua inbox no Chatwoot
-- (17/15/16) e sua instancia no Evolution (Exatidao 01/02/03). Um campo unico
-- em tenant_config so funciona para cliente de um numero so, e aplicaria a
-- etiqueta no WhatsApp errado nos demais.
--
-- `tenant_config.evo_instancia` continua valendo como padrao para o cliente que
-- tem um numero so; esta tabela vence quando existe linha para a inbox.
CREATE TABLE inbox_instances (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cw_inbox_id    INTEGER NOT NULL,
  cw_inbox_nome  TEXT,
  evo_instancia  TEXT    NOT NULL,
  ativa          INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, cw_inbox_id)
);
CREATE INDEX idx_inbox_instances_tenant ON inbox_instances(tenant_id);
