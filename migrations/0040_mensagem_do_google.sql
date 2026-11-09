-- Mensagem do Google se divide em duas etiquetas, nos clientes todos:
--   msg-site  lead do Google que chegou pelo site, com protocolo
--   msg-nat   lead do Google que chegou pelo texto pronto da extensao de
--             mensagem do anuncio, sem site e sem protocolo
-- A Meta segue com `mensagem`. Ate' aqui so' a Vita tinha as duas, e a Vita nao
-- tinha `mensagem`, que agora e' a etiqueta dos leads da Meta nela tambem.

INSERT INTO padrao_etiquetas (slug, cor, descricao, posicao)
SELECT 'msg-site', '#2980b9', 'Lead do Google que chegou pelo site, com protocolo',
       (SELECT COALESCE(MAX(posicao), 0) + 1 FROM padrao_etiquetas)
WHERE NOT EXISTS (SELECT 1 FROM padrao_etiquetas WHERE slug = 'msg-site');

INSERT INTO padrao_etiquetas (slug, cor, descricao, posicao)
SELECT 'msg-nat', '#d35400', 'Lead do Google pela mensagem pronta do anuncio, sem site',
       (SELECT COALESCE(MAX(posicao), 0) + 1 FROM padrao_etiquetas)
WHERE NOT EXISTS (SELECT 1 FROM padrao_etiquetas WHERE slug = 'msg-nat');

UPDATE padrao_etiquetas SET descricao = 'Lead da Meta (ou sem anuncio) que iniciou por mensagem'
 WHERE slug = 'mensagem';

INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot, label_whatsapp)
SELECT t.id, s.slug, s.slug, NULL
  FROM tenants t, (SELECT 'msg-site' AS slug UNION ALL SELECT 'msg-nat' UNION ALL SELECT 'mensagem') s
 WHERE NOT EXISTS (SELECT 1 FROM label_vocabulary v WHERE v.tenant_id = t.id AND v.slug = s.slug);

-- A mensagem inicial da extensao de mensagem do Google Ads.
INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma)
SELECT t.id, 'Olá, vim pelo anúncio do Google!', 'mensagem', 'google'
  FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM lead_entry_phrases f WHERE f.tenant_id = t.id AND f.frase = 'Olá, vim pelo anúncio do Google!'
 );
