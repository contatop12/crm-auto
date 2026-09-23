-- A etapa do card no Kanban espelhada na coluna "Status" da aba Geral.
--
-- Por cliente: a Geral dos outros tem uma coluna Status que o time preenche a
-- mao, e sobrescrever isso seria apagar trabalho deles. Nasce desligado; a
-- Vita pediu (22/09) e ja' liga aqui.
--
-- O gatilho e' uma regra de automacao do Chatwoot que chama
-- /ingest/<slug>/kanban?evento=etapa a cada atualizacao de card do board do
-- funil — as regras de conversao so' cobrem algumas etapas.
ALTER TABLE tenant_config ADD COLUMN sheets_status_etapa INTEGER NOT NULL DEFAULT 0;

UPDATE tenant_config SET sheets_status_etapa = 1
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'vita');
