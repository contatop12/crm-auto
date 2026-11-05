-- Categorias de etiquetas do Chatwoot, desenhadas por script no painel
-- (docs/superpowers/specs/2026-11-04-categorias-de-etiquetas-design.md).
--
-- Moram aqui porque a API de conta do Chatwoot nao aceita campo livre. A chave e'
-- a conta do Chatwoot, nao o tenant: nem toda conta do Chatwoot e' cliente do CRM.
CREATE TABLE etiqueta_categorias (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cw_account_id INTEGER NOT NULL,
  nome          TEXT NOT NULL COLLATE NOCASE,
  posicao       INTEGER NOT NULL DEFAULT 0,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cw_account_id, nome)
);

-- Uma etiqueta fica em uma categoria so', ou em nenhuma (sem linha aqui). Pelo id
-- da etiqueta: renomear a etiqueta no Chatwoot nao perde a categoria.
CREATE TABLE etiqueta_categoria_itens (
  cw_account_id INTEGER NOT NULL,
  label_id      INTEGER NOT NULL,
  categoria_id  INTEGER NOT NULL REFERENCES etiqueta_categorias(id),
  PRIMARY KEY (cw_account_id, label_id)
);

-- Avisos que so' podem sair uma vez: versao nova do Chatwoot ou script quebrado
-- numa versao. A chave ja' diz qual, ex.: `versao:4.19.0-fazer-ai-pro.164`.
CREATE TABLE avisos_chatwoot (
  chave      TEXT PRIMARY KEY,
  avisado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
