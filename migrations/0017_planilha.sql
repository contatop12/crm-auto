-- Para onde cada dado vai, na planilha geral de leads.
--
-- A coluna e' escolhida por quem opera, nao pelo codigo: cada cliente ja' tem a
-- planilha dele, com as colunas na ordem que o time acostumou. Impor uma ordem
-- nossa obrigaria a refazer a planilha ou a viver com colunas trocadas.
--
-- `coluna` e' a letra do Sheets ('A', 'B', ... 'AA'). `campo` e' o nome do dado
-- no nosso lado. Uma coluna recebe um campo; um campo pode ir para mais de uma
-- coluna, porque isso nao machuca ninguem.
CREATE TABLE sheet_columns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  coluna     TEXT    NOT NULL,
  campo      TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, coluna)
);
CREATE INDEX idx_sheet_columns_tenant ON sheet_columns(tenant_id);

-- Ligar por cliente, quando a planilha estiver escolhida. Nasce desligado: sem
-- doc_id nao ha para onde escrever, e tentar a cada conversao so' encheria a
-- tela de erro.
ALTER TABLE tenant_config ADD COLUMN sheets_ativo INTEGER NOT NULL DEFAULT 0;
