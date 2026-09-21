-- A planilha de leads de cada cliente tem uma aba Geral e uma aba por canal.
-- O lead entra nas duas: na Geral e na do canal de onde veio (Google Mensagem,
-- Meta Mensagem). `sheets_leads_aba` era uma aba so' e deixa de ser usada.
ALTER TABLE tenant_config ADD COLUMN sheets_aba_geral TEXT;
ALTER TABLE tenant_config ADD COLUMN sheets_aba_google TEXT;
ALTER TABLE tenant_config ADD COLUMN sheets_aba_meta TEXT;

-- Reconhece o lead da campanha de mensagem do Meta pelo cartao do anuncio que
-- chega na primeira mensagem. Por cliente: so' a Tainã roda campanha de
-- mensagem no Meta hoje.
ALTER TABLE tenant_config ADD COLUMN rastrear_meta_mensagem INTEGER NOT NULL DEFAULT 0;

-- As abas que existem em cada planilha, lidas em 21/09.
UPDATE tenant_config SET sheets_aba_geral = 'Geral', sheets_aba_google = 'Google Mensagem'
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'persianas');

UPDATE tenant_config SET sheets_aba_geral = 'Geral', sheets_aba_google = 'Google Mensagem'
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'locadora');

-- a Vita so' tem a Geral
UPDATE tenant_config SET sheets_aba_geral = 'Geral', sheets_aba_google = NULL
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'vita');

UPDATE tenant_config SET sheets_aba_geral = 'Geral', sheets_aba_google = 'Google Mensagem',
       sheets_aba_meta = 'Meta Mensagem', rastrear_meta_mensagem = 1
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'taina');

-- Reserva para o lead do Meta cujo cartao do anuncio nao vier (WhatsApp Web
-- as vezes nao anexa): a mensagem pronta do anuncio da Tainã.
INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma)
SELECT id, 'Olá! Vi o anúncio e gostaria de agendar uma consulta.', 'mensagem', 'meta'
  FROM tenants WHERE slug = 'taina';
