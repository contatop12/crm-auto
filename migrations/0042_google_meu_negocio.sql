-- Lead do Perfil da Empresa no Google (o antigo Google Meu Negocio), pedido de
-- 17/11/2026: entra no funil com etiqueta propria e NAO sobe conversao ao Ads.
--
-- Chega de dois jeitos:
--   site   link do perfil com utm_campaign=meu_negocio (o CRM le a UTM)
--   chat   botao WhatsApp do perfil, direto, com o texto pronto abaixo
--
-- A Vita ja' tinha `google-meu-negocio` e a Persianas `gmn` (o motor aceita as
-- duas); os outros ganham `google-meu-negocio`.

INSERT INTO padrao_etiquetas (slug, cor, descricao, posicao)
SELECT 'google-meu-negocio', '#34a853', 'Lead do Perfil da Empresa no Google (Google Meu Negocio), sem anuncio',
       (SELECT COALESCE(MAX(posicao), 0) + 1 FROM padrao_etiquetas)
WHERE NOT EXISTS (SELECT 1 FROM padrao_etiquetas WHERE slug = 'google-meu-negocio');

INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot, label_whatsapp)
SELECT t.id, 'google-meu-negocio', 'google-meu-negocio', NULL
  FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM label_vocabulary v
    WHERE v.tenant_id = t.id AND v.slug IN ('google-meu-negocio', 'gmn')
 );

INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma)
SELECT t.id, 'Olá, vim pelo Google Meu Negócio!', 'mensagem', 'gmn'
  FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM lead_entry_phrases f WHERE f.tenant_id = t.id AND f.plataforma = 'gmn'
 );
