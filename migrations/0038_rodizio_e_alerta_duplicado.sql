-- Rodizio de atendentes e alerta de contato em dois numeros (Locadora).
--
-- A Locadora tem 3 numeros (inboxes 15=8910, 16=8844, 17=2244 na conta 5).
-- O Chatwoot nao distribui conversa para agente offline, e lead ficava sem
-- responsavel ate' alguem pegar. Agora o CRM atribui quando a mensagem do lead
-- chega, em rodizio dentro da lista da inbox.
--
-- O 8910 fica de fora: la' o time atribui a mao (pedido do cliente, 29/10).
--
-- `cw_rodizio`: JSON {"<inbox>":[<agente>,...]}; NULL = desligado; inbox fora
-- da lista = sem atribuicao automatica.
ALTER TABLE tenant_config ADD COLUMN cw_rodizio TEXT;

-- Contato que fala com dois numeros do mesmo cliente: o alerta vai para este
-- grupo de WhatsApp (jid ...@g.us, via Evolution). NULL = so' registra e loga.
ALTER TABLE tenant_config ADD COLUMN alerta_duplicado_grupo TEXT;

-- Vez de cada inbox. `proximo` so' cresce; o agente e' (proximo-1) % tamanho.
CREATE TABLE rodizio_estado (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  inbox_id  INTEGER NOT NULL,
  proximo   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, inbox_id)
);

-- Um alerta por contato e par de inboxes (a menor primeiro), para nao repetir
-- a cada mensagem. `alertado_em` NULL = detectado, mas o grupo nao estava
-- configurado ou o envio falhou; fica registrado.
CREATE TABLE alertas_duplicado (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  contato_id  INTEGER NOT NULL,
  inbox_a     INTEGER NOT NULL,
  inbox_b     INTEGER NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  alertado_em TEXT,
  UNIQUE (tenant_id, contato_id, inbox_a, inbox_b)
);

UPDATE tenant_config SET cw_rodizio = '{"16":[12],"17":[14]}'
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'locadora');
