-- Uma chave por webhook, nao uma por cliente.
--
-- Com chave unica, trocar a do Meta derruba junto o GTM e o Chatwoot do mesmo
-- cliente: quatro enderecos para reconfigurar por causa de um. E o inverso e'
-- pior — a chave do Meta, que passa por uma automacao de terceiro, tem o mesmo
-- poder de gravar cliques e mover conversoes.
--
-- Sao tres canais, nao quatro: as duas rotas do Kanban sao o MESMO endereco,
-- separadas por `&evento=conversao`, entao compartilham a chave por construcao.
CREATE TABLE ingest_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  canal       TEXT    NOT NULL CHECK (canal IN ('click','kanban','meta')),
  chave       TEXT    NOT NULL,
  -- 0 = ainda nao foi exibida; pode ser vista uma vez
  revelada    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, canal)
);
CREATE INDEX idx_ingest_keys_tenant ON ingest_keys(tenant_id);

-- Comeca com a chave que cada cliente ja' usa, nos tres canais. Sortear chaves
-- novas aqui derrubaria todo endereco colado no GTM, no Chatwoot e no Make no
-- instante da migracao — sem aviso e sem ninguem olhando. Separar agora, girar
-- quando alguem decidir.
INSERT INTO ingest_keys (tenant_id, canal, chave, revelada)
SELECT tenant_id, c.canal, ingest_key, 1
  FROM tenant_config
  CROSS JOIN (SELECT 'click' AS canal UNION ALL SELECT 'kanban' UNION ALL SELECT 'meta') c
 WHERE ingest_key IS NOT NULL;
