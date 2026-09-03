-- Container modelo do GTM e o container escolhido de cada cliente.
--
-- O modelo fica no banco, nao no bundle: ele muda quando o rastreamento muda,
-- e trocar um JSON de 42 KB nao deveria exigir deploy.
CREATE TABLE padrao_gtm (
  id            INTEGER PRIMARY KEY CHECK (id = 1),  -- so' existe um modelo
  nome          TEXT NOT NULL,
  json          TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Qual container do cliente recebe a padronizacao. Conta e container sao
-- escolhidos na tela, porque uma conta pode ter varios.
ALTER TABLE tenant_config ADD COLUMN gtm_account_id TEXT;
ALTER TABLE tenant_config ADD COLUMN gtm_container_id TEXT;
-- Prefixo do protocolo (VITA, PERS) e o id do cliente no rastreio, que vao
-- para as constantes do container.
ALTER TABLE tenant_config ADD COLUMN gtm_prefixo TEXT;
