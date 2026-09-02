-- Credenciais obtidas por OAuth em tempo de execucao.
--
-- Secret do Worker nao serve: `wrangler secret` so' grava do lado de fora, e
-- o refresh token do Tag Manager chega quando o usuario consente, ja com o
-- Worker no ar.
CREATE TABLE credenciais (
  chave         TEXT PRIMARY KEY,   -- 'gtm_refresh_token'
  valor         TEXT NOT NULL,
  obtido_por    TEXT,               -- e-mail de quem consentiu
  escopos       TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
