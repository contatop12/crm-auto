-- Tainã: Consulta Realizada (CRM - Lead Qualificado 2) passa a valer R$ 250,
-- pela planilha de etapas revisada em 21/09.
UPDATE funnel_stages SET conversion_value = 250
 WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'taina') AND cw_step_id = 67;
