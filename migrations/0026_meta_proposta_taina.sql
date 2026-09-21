-- Tainã: "CRM - Proposta Enviada" criada no Google Ads (7785216846, R$ 20,
-- secundaria) e ligada a etapa Proposta Enviada. Janela de clique de 90 dias,
-- como as outras metas CRM da conta.
UPDATE funnel_stages SET conversion_action_id = '7785216846', ca_janela_clique = 90
 WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'taina') AND cw_step_id = 22;
UPDATE funnel_stages SET ca_janela_clique = 90
 WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'taina') AND conversion_event IS NOT NULL;
