-- Todo lead na planilha de leads, cada um na sua aba.
--
-- 1. `sheets_aba_direto`: a aba de quem chamou no WhatsApp sem anuncio (sem
--    protocolo, ou com protocolo do site mas sem plataforma). Vazia = o cliente
--    nao registra lead direto — e' o que vale para todos, menos a Vita.
-- 2. `numeros_proprios`: JSON com os numeros da propria empresa. Mensagem vinda
--    deles nao e' lead (a Vita tem um segundo numero que conversa com o
--    principal e virou "lead" em 27/08).
-- 3. `leads_diretos`: um registro por contato. As duas UNIQUE sao a trava de
--    duplicata — a mesma conversa, ou o mesmo telefone em outra conversa, nao
--    entra de novo. O Banco de Dados NAO recebe lead direto: ele guarda so'
--    clique e protocolo.
ALTER TABLE tenant_config ADD COLUMN sheets_aba_direto TEXT;
ALTER TABLE tenant_config ADD COLUMN numeros_proprios TEXT;

CREATE TABLE leads_diretos (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cw_conversation_id  INTEGER NOT NULL,
  phone_key           TEXT,
  nome                TEXT,
  telefone            TEXT,
  chegou_em           TEXT,
  planilha_status     TEXT NOT NULL DEFAULT 'pendente',
  planilha_erro       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, cw_conversation_id)
);
CREATE UNIQUE INDEX idx_leads_diretos_fone ON leads_diretos(tenant_id, phone_key) WHERE phone_key IS NOT NULL;

-- Vita: abas lidas em 21/09 — so' existia a Geral para lead de mensagem. As
-- abas "Google Mensagem" e "WhatsApp Direto" sao criadas pelo plano de dados
-- ANTES desta migration ir para producao (escrever em aba inexistente falha,
-- e a falha so' fica no log).
-- Numeros proprios: 5519991460270 (o WhatsApp da instancia "Vita Audio") e
-- 5519990177608 (o segundo numero da clinica, perfil "Vita Audio Aparelhos
-- Auditivos").
UPDATE tenant_config SET
  sheets_aba_google = 'Google Mensagem',
  sheets_aba_direto = 'WhatsApp Direto',
  numeros_proprios  = '["5519991460270","5519990177608"]'
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'vita');
