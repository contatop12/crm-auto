-- Quem escreve nas planilhas do cliente: o proprio sistema, pela service
-- account `crm-api@crm-p12.iam.gserviceaccount.com`, ou o n8n, pelo webhook.
--
-- Nasce 'sistema': e' o caminho sem consentimento e sem fluxo externo. O n8n
-- fica como alternativa por cliente. `sheets_ativo` continua o interruptor e
-- esta' desligado em todos — nada muda ate' alguem ligar no painel.
ALTER TABLE tenant_config ADD COLUMN planilha_modo TEXT NOT NULL DEFAULT 'sistema'
  CHECK (planilha_modo IN ('sistema', 'n8n'));

-- As planilhas de cada cliente, tiradas dos fluxos n8n que escreviam nelas.
-- COALESCE: nao sobrescreve o que ja' tiver sido escolhido no painel.
UPDATE tenant_config SET
  sheets_doc_id       = COALESCE(sheets_doc_id, '1tRG6GA_L2UqJVEkoriZ5Hm8oYXeNIvw8RooYPWSKhPM'),
  sheets_leads_doc_id = COALESCE(sheets_leads_doc_id, '1j-w1Vw2OAV8f-HqWM7zzFMqAHgjsGgOS2aEQhaxxLn0'),
  sheets_leads_aba    = COALESCE(sheets_leads_aba, 'Google Mensagem')
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'persianas');

UPDATE tenant_config SET
  sheets_doc_id       = COALESCE(sheets_doc_id, '1MMnX9FHJ_3gMs-DBD-Nj5zDB9AikcsIxSA50hsBwjHo'),
  sheets_leads_doc_id = COALESCE(sheets_leads_doc_id, '1KMnwB0q2yFjpISN_QX7kr-BhhsoJoKep317qH_u3m3k'),
  sheets_leads_aba    = COALESCE(sheets_leads_aba, 'Geral')
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'vita');

UPDATE tenant_config SET
  sheets_doc_id       = COALESCE(sheets_doc_id, '1NJ6rifdIjYbqwbxvv0W1VEng9GRxfqc3TPfLtReA4aI'),
  sheets_leads_doc_id = COALESCE(sheets_leads_doc_id, '1_FUKAUvlr1O8O2jMJCVbcdsWXUdjRMvDJo8fSHmQPBw'),
  sheets_leads_aba    = COALESCE(sheets_leads_aba, 'Google Mensagem')
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'locadora');

UPDATE tenant_config SET
  sheets_doc_id       = COALESCE(sheets_doc_id, '1kRIQ7Yyszd49zndSddrQ7MmXOMXiPQV5zCptCYTTR1s'),
  sheets_leads_doc_id = COALESCE(sheets_leads_doc_id, '1agGk8HN98inXotnusMoxKGwyJoftzeoMQyTT55kPMuc'),
  sheets_leads_aba    = COALESCE(sheets_leads_aba, 'Google Mensagem')
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'taina');
