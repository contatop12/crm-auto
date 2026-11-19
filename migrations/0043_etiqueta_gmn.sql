-- Etiqueta do Perfil da Empresa no Google: `google-meu-negocio` vira `gmn`, pedido
-- de 19/11/2026. A Persianas ja' usava `gmn`; nos outros a etiqueta do Chatwoot
-- e' renomeada (mesmo id, as conversas acompanham) e o vocabulario segue aqui.
-- O motor ainda aceita `google-meu-negocio` de reserva (labels.ts).
-- Backup das linhas antes da troca: backups/etiqueta-gmn-20261119/d1-etiqueta-gmn.json.

UPDATE label_vocabulary
   SET slug = 'gmn', label_chatwoot = 'gmn'
 WHERE slug = 'google-meu-negocio'
   AND NOT EXISTS (
     SELECT 1 FROM label_vocabulary g WHERE g.tenant_id = label_vocabulary.tenant_id AND g.slug = 'gmn'
   );

UPDATE padrao_etiquetas
   SET slug = 'gmn', descricao = 'Lead do Perfil da Empresa no Google (GMN), sem anuncio'
 WHERE slug = 'google-meu-negocio'
   AND NOT EXISTS (SELECT 1 FROM padrao_etiquetas g WHERE g.slug = 'gmn');
