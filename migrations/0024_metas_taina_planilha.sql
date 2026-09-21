-- Tainã: etapas e conversoes pela planilha de etapas do cliente (21/09).
--
--   Novo Lead              -> CRM - Conversa Iniciada   R$ 10  (primaria)   [ja estava]
--   Proposta Enviada       -> CRM - Proposta Enviada    R$ 20              [meta nova]
--   Agendamento Realizado  -> CRM - Lead Qualificado 1  R$ 150
--   Consulta Realizada     -> CRM - Lead Qualificado 2  R$ 300
--   Oportunidade Ganha     -> CRM - Compra (valor real)                    [ja estava]
--
-- Ate aqui os Qualificados estavam uma etapa antes (LQ1 em Proposta Enviada,
-- LQ2 em Agendamento). A meta "CRM - Proposta Enviada" ainda nao existe na
-- conta: fica ligada sem id, e a tela de metas do painel a cria.

UPDATE funnel_stages SET
  conversion_event = 'proposta_enviada', conversion_action_id = NULL, conversion_value = 20,
  ca_nome = 'CRM - Proposta Enviada', ca_categoria = 'QUALIFIED_LEAD', ca_contagem = 'ONE_PER_CLICK',
  ca_janela_clique = 30, ca_janela_view = 1, ca_primary = 0
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'taina') AND cw_step_id = 22;

UPDATE funnel_stages SET
  conversion_event = 'qualificado_1', conversion_action_id = '7694731833', conversion_value = 150,
  ca_nome = 'CRM - Lead Qualificado 1', ca_categoria = 'QUALIFIED_LEAD', ca_contagem = 'ONE_PER_CLICK',
  ca_janela_clique = 30, ca_janela_view = 1, ca_primary = 0
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'taina') AND cw_step_id = 23;

UPDATE funnel_stages SET
  conversion_event = 'qualificado_2', conversion_action_id = '7694732055', conversion_value = 300,
  ca_nome = 'CRM - Lead Qualificado 2', ca_categoria = 'QUALIFIED_LEAD', ca_contagem = 'ONE_PER_CLICK',
  ca_janela_clique = 30, ca_janela_view = 1, ca_primary = 0
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'taina') AND cw_step_id = 67;

-- A mensagem do agendamento: "essa é a ficha pré consulta que precisa ser
-- preenchida". So' o fim: o time escreve "pré consulta" ou "pré-consulta", e a
-- comparacao nao ignora o hifen.
INSERT INTO stage_triggers (tenant_id, stage_id, frase, tipo)
SELECT s.tenant_id, s.id, 'consulta que precisa ser preenchida', 'contem'
  FROM funnel_stages s JOIN tenants t ON t.id = s.tenant_id
 WHERE t.slug = 'taina' AND s.cw_step_id = 23;
