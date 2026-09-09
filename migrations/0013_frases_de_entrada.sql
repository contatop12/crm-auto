-- Frase que PROVA que o lead veio de anuncio, mesmo sem clique registrado.
--
-- O botao do anuncio abre o WhatsApp com um texto pronto. Quando o clique nao
-- chega ate' nos — GTM que nao disparou, navegador que bloqueou, lead que
-- copiou o link — a mensagem ainda carrega a origem: aquele texto so' existe
-- porque alguem apertou aquele botao.
--
-- Ate' agora esses leads eram descartados com "sem protocolo na mensagem e sem
-- clique para o telefone". Sao leads de anuncio pagos e perdidos.
CREATE TABLE lead_entry_phrases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  frase       TEXT    NOT NULL,   -- comparada normalizada (sem acento/emoji, minuscula)
  origem      TEXT    NOT NULL DEFAULT 'mensagem',  -- vira a etiqueta de origem
  plataforma  TEXT    NOT NULL DEFAULT 'google',    -- vira `google-ads` / `meta-ads`
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lead_entry_phrases_tenant ON lead_entry_phrases(tenant_id);

-- Vita Audio: o texto que o botao do anuncio de avaliacao auditiva ja' manda.
INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma)
SELECT id, 'Olá! Vim pelo google e gostaria de agendar uma avaliação auditiva.', 'mensagem', 'google'
  FROM tenants WHERE slug = 'vita';
